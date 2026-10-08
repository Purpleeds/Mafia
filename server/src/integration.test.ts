import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import type {
  ChatMessage,
  ClientEventName,
  ClientToServerEvents,
  GameStatePayload,
  RemovedPayload,
  Role,
  ServerToClientEvents,
  SessionInfo,
} from "@mafia/shared";
import { createMafiaServer, type MafiaServerInstance } from "./app.js";
import { createMemoryLogger } from "./logger.js";
import { DEFAULT_RATE_LIMITS } from "./socket/rateLimiter.js";

type AckOf<E extends ClientEventName> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];

/** A browser stand-in that records everything the server sends it. */
class TestClient {
  readonly socket: ClientSocket<ServerToClientEvents, ClientToServerEvents>;
  readonly received: Array<{ event: string; payload: unknown }> = [];
  state: GameStatePayload | null = null;
  chat: ChatMessage[] = [];
  removed: RemovedPayload | null = null;
  replaced = false;
  session: SessionInfo | null = null;

  constructor(url: string) {
    this.socket = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
    this.socket.onAny((event: string, payload: unknown) => this.received.push({ event, payload }));
    this.socket.on("game:state", (p) => {
      if (!this.state || p.version >= this.state.version) this.state = p;
    });
    this.socket.on("chat:message", (m) => this.chat.push(m));
    this.socket.on("room:removed", (p) => {
      this.removed = p;
    });
    this.socket.on("session:replaced", () => {
      this.replaced = true;
    });
  }

  get view() {
    if (!this.state) throw new Error("no state yet");
    return this.state.view;
  }

  get role(): Role {
    const role = this.view.you?.role;
    if (!role) throw new Error("no role yet");
    return role;
  }

  get id(): string {
    if (!this.session) throw new Error("no session");
    return this.session.playerId;
  }

  async call<E extends ClientEventName>(event: E, payload: Parameters<ClientToServerEvents[E]>[0]): Promise<AckOf<E>> {
    const s = this.socket as unknown as { timeout(ms: number): { emitWithAck(e: string, ...a: unknown[]): Promise<unknown> } };
    return (await s.timeout(3000).emitWithAck(event, payload)) as AckOf<E>;
  }

  /** Sends anything at all, bypassing the types. */
  async raw(event: string, ...args: unknown[]): Promise<unknown> {
    const s = this.socket as unknown as { timeout(ms: number): { emitWithAck(e: string, ...a: unknown[]): Promise<unknown> } };
    return s.timeout(3000).emitWithAck(event, ...args);
  }

  rolesSeen(): string[] {
    return this.received.flatMap((r) => [...JSON.stringify(r.payload).matchAll(/"role":"(\w+)"/g)].map((m) => m[1] ?? ""));
  }

  close() {
    this.socket.close();
  }
}

async function waitFor(check: () => boolean, label = "condition", ms = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function expectOk<T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.data;
}

function expectError(result: { ok: boolean; error?: { code: string } }, code: string): void {
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe(code);
}

let server: MafiaServerInstance;
let url: string;
const logger = createMemoryLogger();
const clients: TestClient[] = [];

function client(): TestClient {
  const c = new TestClient(url);
  clients.push(c);
  return c;
}

beforeAll(async () => {
  server = createMafiaServer({
    clientDist: null,
    logger,
    disconnectGraceMs: 100,
    rateLimits: {
      connection: { capacity: 1000, refillPerSecond: 100 },
      joinRoom: { capacity: 1000, refillPerSecond: 100 },
      createRoom: { capacity: 1000, refillPerSecond: 100 },
      chat: DEFAULT_RATE_LIMITS.chat,
    },
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

async function lobbyOf(n: number): Promise<TestClient[]> {
  const host = client();
  host.session = expectOk(await host.call("room:create", { name: "Host" }));
  const players = [host];
  for (let i = 2; i <= n; i++) {
    const c = client();
    c.session = expectOk(await c.call("room:join", { roomCode: host.session.roomCode.toLowerCase(), name: `Player ${i}` }));
    players.push(c);
  }
  await waitFor(() => players.every((p) => p.state?.view.players.length === n), "everyone to see the full lobby");
  return players;
}

describe("over real sockets", () => {
  it("greets new connections with the server time", async () => {
    const c = client();
    const hello = await new Promise<{ serverNow: number }>((resolve) => c.socket.once("server:hello", resolve));
    expect(Math.abs(hello.serverNow - Date.now())).toBeLessThan(1000);
    const sync = expectOk(await c.call("time:sync", { clientSentAt: 123 }));
    expect(sync.clientSentAt).toBe(123);
    expect(Math.abs(sync.serverNow - Date.now())).toBeLessThan(1000);
  });

  it("plays a night without leaking anything to anyone", async () => {
    const players = await lobbyOf(8);
    const [host] = players as [TestClient];
    expectOk(await host.call("lobby:updateSettings", { revealRoleOnDeath: false }));
    expectError(await players[1]!.call("game:start", {}), "NOT_HOST");
    expectOk(await host.call("game:start", {}));
    await waitFor(() => players.every((p) => p.state?.view.phase === "ROLE_REVEAL"), "role reveal");

    // the countdown comes from server time only
    const reveal = host.state!;
    const remaining = (reveal.view.phaseEndsAt ?? 0) - reveal.serverNow;
    expect(remaining).toBeGreaterThan(9_900);
    expect(remaining).toBeLessThanOrEqual(10_000);

    const byRole = (role: Role) => players.filter((p) => p.role === role);
    const mafia = byRole("mafia");
    const [doctor] = byRole("doctor") as [TestClient];
    const [detective] = byRole("detective") as [TestClient];
    const villagers = byRole("villager");
    const [victim, bystander] = villagers as [TestClient, TestClient];
    expect(mafia).toHaveLength(2);
    expect(mafia[0]!.view.you?.teammateIds).toEqual([mafia[1]!.id]);
    expect(victim.view.you?.teammateIds).toEqual([]);

    for (const p of players) expectOk(await p.call("game:ackRole", {}));
    await waitFor(() => players.every((p) => p.state?.view.phase === "NIGHT"), "night");

    // validation: wrong phase, no ability, bad payloads, identity spoofing
    expectError(await bystander.call("game:vote", { targetId: "skip" }), "WRONG_PHASE");
    expectError(await bystander.call("game:nightAction", { targetId: victim.id }), "NO_ABILITY");
    expectError(await doctor.call("game:nightAction", { targetId: "nobody-here" }), "INVALID_TARGET");
    expectError((await bystander.raw("game:vote", { targetId: 42 })) as { ok: boolean }, "BAD_REQUEST");
    expectError((await bystander.raw("game:nightAction", "not an object")) as { ok: boolean }, "BAD_REQUEST");
    const spoof = { targetId: victim.id, playerId: mafia[0]!.id } as unknown as { targetId: string };
    expectError(await bystander.call("game:nightAction", spoof), "NO_ABILITY");
    expectError(await mafia[0]!.call("game:nightAction", { targetId: mafia[1]!.id }), "INVALID_TARGET");

    // chat: the town is silent, the Mafia talk privately
    expectError(await bystander.call("chat:send", { channel: "public", text: "hello?" }), "CHAT_NOT_ALLOWED");
    expectError(await bystander.call("chat:send", { channel: "mafia", text: "let me in" }), "CHAT_NOT_ALLOWED");
    expectOk(await mafia[0]!.call("chat:send", { channel: "mafia", text: "victim it is" }));
    await waitFor(() => mafia[1]!.chat.some((m) => m.text === "victim it is"), "mafia chat");

    expectOk(await mafia[0]!.call("game:nightAction", { targetId: victim.id }));
    expectOk(await mafia[1]!.call("game:nightAction", { targetId: victim.id }));
    expectOk(await doctor.call("game:nightAction", { targetId: doctor.id }));
    expectOk(await detective.call("game:nightAction", { targetId: mafia[0]!.id }));
    await waitFor(() => players.every((p) => p.state?.view.phase === "NIGHT_RESULTS"), "night results");

    expect(host.view.nightReport?.deaths).toEqual([{ playerId: victim.id, cause: "mafia", role: null }]);
    expect(detective.view.you?.investigations).toEqual([{ round: 1, targetId: mafia[0]!.id, isMafia: true }]);

    // Every message each client ever received: only their own role, and secrets only where they belong.
    for (const p of players) {
      const own = p.role;
      for (const role of p.rolesSeen()) expect(role).toBe(own);
      const wire = JSON.stringify(p.received);
      if (p !== detective) expect(wire).not.toContain('"investigations":[{');
      if (!mafia.includes(p)) {
        expect(wire).not.toContain("victim it is");
        expect(wire).not.toMatch(/"teammateVotes":\{"/);
        expect(wire).not.toMatch(/"teammateIds":\["/);
      }
    }

    // the dead can't talk to the living, but have their own channel
    expectError(await victim.call("chat:send", { channel: "public", text: "it was them!" }), "CHAT_NOT_ALLOWED");
    expectOk(await victim.call("chat:send", { channel: "graveyard", text: "boo" }));
    await waitFor(() => victim.chat.some((m) => m.text === "boo"), "graveyard echo");
    for (const p of players.filter((x) => x !== victim)) expect(p.chat.some((m) => m.text === "boo")).toBe(false);
  });

  it("rejects game events from sockets that haven't joined", async () => {
    const c = client();
    expectError(await c.call("game:vote", { targetId: "skip" }), "NOT_IN_ROOM");
    expectError(await c.call("chat:send", { channel: "public", text: "hi" }), "NOT_IN_ROOM");
    expectError(await c.call("room:join", { roomCode: "ZZZZ", name: "Lost" }), "ROOM_NOT_FOUND");
    expectError((await c.raw("room:join", { roomCode: "TOO-LONG", name: "x" })) as { ok: boolean }, "BAD_REQUEST");
  });

  it("drops unknown events", async () => {
    const c = client();
    expectError((await c.raw("admin:giveMeRoles", {})) as { ok: boolean }, "BAD_REQUEST");
    expect(logger.lines.some((l) => l.startsWith("WARN event.unknown"))).toBe(true);
  });

  it("rate-limits chat spam", async () => {
    const [host] = await lobbyOf(2);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => host!.call("chat:send", { channel: "public", text: `spam ${i}` })),
    );
    const limited = results.filter((r) => !r.ok && r.error.code === "RATE_LIMITED");
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(limited).toHaveLength(5);
    expect(logger.lines.some((l) => l.includes("event.rate_limited") && l.includes("category=chat"))).toBe(true);
  });

  it("answers events sent without an ack through server:error", async () => {
    const c = client();
    const error = new Promise((resolve) => c.socket.once("server:error", resolve));
    (c.socket as unknown as { emit(e: string, p: unknown): void }).emit("game:vote", { targetId: "skip" });
    expect(await error).toMatchObject({ code: "NOT_IN_ROOM" });
  });

  it("lets a player come back after a refresh, with the same seat", async () => {
    const [host, guest] = (await lobbyOf(2)) as [TestClient, TestClient];
    const token = guest.session!;
    guest.close();
    const again = client();
    const resumed = expectOk(await again.call("room:resume", token));
    expect(resumed.playerId).toBe(token.playerId);
    await waitFor(() => again.state?.view.you?.id === token.playerId, "resumed state");
    // back within the grace period: nobody ever saw them disconnect
    await new Promise((r) => setTimeout(r, 150));
    expect(host.view.players[1]?.connected).toBe(true);

    expectError(await client().call("room:resume", { ...token, sessionToken: "x".repeat(32) }), "SESSION_INVALID");
  });

  it("marks a player disconnected after the grace period", async () => {
    const [host, guest] = (await lobbyOf(2)) as [TestClient, TestClient];
    guest.close();
    await waitFor(() => host.state?.view.players[1]?.connected === false, "guest shown as disconnected");
  });

  it("keeps one connection per player", async () => {
    const [, guest] = (await lobbyOf(2)) as [TestClient, TestClient];
    const tab = client();
    expectOk(await tab.call("room:resume", guest.session!));
    await waitFor(() => guest.replaced && !guest.socket.connected, "old tab closed");
    expectOk(await tab.call("chat:send", { channel: "public", text: "from the new tab" }));
  });

  it("removes a player who leaves the lobby", async () => {
    const [host, guest] = (await lobbyOf(2)) as [TestClient, TestClient];
    expectOk(await guest.call("room:leave", {}));
    await waitFor(() => guest.removed?.reason === "left", "removal notice");
    await waitFor(() => host.view.players.length === 1, "host sees one player");
    expectError(await guest.call("game:start", {}), "NOT_IN_ROOM");
  });

  it("logs room creation and game start for Render", () => {
    expect(logger.lines.some((l) => l.startsWith("INFO room.created"))).toBe(true);
    expect(logger.lines.some((l) => l.startsWith("INFO game.started") && l.includes("players=8"))).toBe(true);
  });
});
