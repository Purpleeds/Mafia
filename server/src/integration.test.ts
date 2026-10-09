import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NarratorRequestPayload, Role } from "@mafia/shared";
import { createMafiaServer, type MafiaServerInstance } from "./app.js";
import { createMemoryLogger } from "./logger.js";
import { DEFAULT_RATE_LIMITS } from "./socket/rateLimiter.js";
import { AVATAR, TestClient, expectError, expectOk, waitFor } from "./testing/socketClient.js";

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
    disconnectGraceMs: 150,
    // every test client shares 127.0.0.1
    service: { maxRoomsPerOwner: 1000 },
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
  host.session = expectOk(await host.call("room:create", { name: "Host", avatar: AVATAR }));
  const players = [host];
  for (let i = 2; i <= n; i++) {
    const c = client();
    c.session = expectOk(
      await c.call("room:join", { roomCode: host.session.roomCode.toLowerCase(), name: `Player ${i}`, avatar: AVATAR }),
    );
    players.push(c);
  }
  await waitFor(() => players.every((p) => p.state?.view.players.length === n), "everyone to see the full lobby");
  return players;
}

describe("over real sockets", () => {
  it("answers the health checks", async () => {
    for (const path of ["/health", "/healthz"]) {
      const response = await fetch(`${url}${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
  });

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
    expectOk(await host.call("host:updateSettings", { revealRoleOnDeath: false }));
    expectError(await players[1]!.call("host:start", {}), "NOT_HOST");
    expectOk(await host.call("host:start", {}));
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
    expectError(await bystander.call("chat:send", { text: "hello?" }), "CHAT_NOT_ALLOWED");
    expectError(await bystander.call("chat:send", { text: "let me in" }), "CHAT_NOT_ALLOWED");
    expectOk(await mafia[0]!.call("chat:send", { text: "victim it is" }));
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

    // by day the dead have their own channel, and the server routes them there: the living never see it
    expectOk(await victim.call("chat:send", { text: "it was them!" }));
    expectOk(await victim.call("chat:react", { reaction: "no_way" }));
    await waitFor(() => victim.chat.some((m) => m.reaction === "no_way"), "graveyard echo");
    expect(victim.chat.every((m) => m.channel === "graveyard" || m.channel === "mafia" || m.channel === "public")).toBe(true);
    for (const p of players.filter((x) => x !== victim)) {
      expect(p.chat.some((m) => m.text === "it was them!" || m.reaction === "no_way")).toBe(false);
    }
  });

  it("sends narration requests to the host's browser only, and shows the AI's text to everyone", async () => {
    const players = await lobbyOf(8);
    const [host, second] = players as [TestClient, TestClient];
    expectOk(await host.call("host:updateSettings", { aiNarrator: true }));
    expectError(await second.call("host:updateSettings", { aiNarrator: false }), "NOT_HOST");
    expectOk(await host.call("host:start", {}));
    await waitFor(() => players.every((p) => p.state?.view.phase === "ROLE_REVEAL"), "role reveal");
    for (const p of players) expectOk(await p.call("game:ackRole", {}));
    await waitFor(() => players.every((p) => p.state?.view.phase === "NIGHT"), "night");

    const byRole = (role: Role) => players.filter((p) => p.role === role);
    const mafia = byRole("mafia");
    const [doctor] = byRole("doctor") as [TestClient];
    const [detective] = byRole("detective") as [TestClient];
    const victim = byRole("villager").find((p) => p !== host) as TestClient;
    for (const m of mafia) expectOk(await m.call("game:nightAction", { targetId: victim.id }));
    expectOk(await doctor.call("game:nightAction", { targetId: doctor.id }));
    expectOk(await detective.call("game:nightAction", { targetId: mafia[0]!.id }));
    await waitFor(() => players.every((p) => p.state?.view.phase === "NIGHT_RESULTS"), "night results");

    // Everyone sees a narrator that is still thinking...
    await waitFor(() => host.received.some((r) => r.event === "narrator:request"), "the narrator request");
    expect(players.every((p) => p.view.narration?.status === "thinking")).toBe(true);

    // ...and only the host's browser was asked, with public facts.
    const request = host.received.find((r) => r.event === "narrator:request")?.payload as NarratorRequestPayload;
    const victimName = victim.view.you?.name ?? "";
    expect(request.facts).toEqual({
      kind: "night",
      mode: "safe",
      round: 1,
      gang: "Mafia",
      eliminated: [{ name: victimName, how: "night" }],
      saved: false,
      voteOutcome: null,
    });
    for (const p of players.filter((p) => p !== host)) {
      expect(p.received.some((r) => r.event === "narrator:request")).toBe(false);
      expect(JSON.stringify(p.received)).not.toContain(request.requestId);
    }

    // Only the host may answer, with a well-formed answer.
    expectError(await second.call("narrator:submit", { requestId: request.requestId, text: "A tale." }), "NOT_HOST");
    expectError((await host.raw("narrator:submit", { requestId: 5, text: "x" })) as { ok: boolean }, "BAD_REQUEST");
    expectError((await host.raw("narrator:submit", { requestId: request.requestId, text: { a: 1 } })) as { ok: boolean }, "BAD_REQUEST");
    expectError((await host.raw("narrator:submit", "nope")) as { ok: boolean }, "BAD_REQUEST");

    const text = `The lamps flickered over the village, and ${victimName} was whisked away by the Mafia.`;
    expectOk(await host.call("narrator:submit", { requestId: request.requestId, text }));
    await waitFor(() => players.every((p) => p.view.narration?.status === "ready"), "the narration");
    for (const p of players) {
      expect(p.view.narration).toEqual({ kind: "night", round: 1, status: "ready", text, source: "ai" });
    }
  });

  it("rejects game events from sockets that haven't joined", async () => {
    const c = client();
    expectError(await c.call("game:vote", { targetId: "skip" }), "NOT_IN_ROOM");
    expectError(await c.call("chat:send", { text: "hi" }), "NOT_IN_ROOM");
    expectError(await c.call("room:join", { roomCode: "ZZZZ", name: "Lost", avatar: AVATAR }), "ROOM_NOT_FOUND");
    expectError(
      (await c.raw("room:join", { roomCode: "WAY-TOO-LONG", name: "x", avatar: AVATAR })) as { ok: boolean },
      "BAD_REQUEST",
    );
  });

  it("drops unknown events", async () => {
    const c = client();
    expectError((await c.raw("admin:giveMeRoles", {})) as { ok: boolean }, "BAD_REQUEST");
    expect(logger.lines.some((l) => l.startsWith("WARN event.unknown"))).toBe(true);
  });

  it("rate-limits chat spam", async () => {
    const [host] = await lobbyOf(2);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => host!.call("chat:send", { text: `spam ${i}` })),
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
    // back within the grace period: never counted as gone
    await new Promise((r) => setTimeout(r, 200));
    expect(host.view.players[1]).toMatchObject({ connected: true, connection: "online" });

    expectError(await client().call("room:resume", { ...token, sessionToken: "x".repeat(32) }), "SESSION_INVALID");
  });

  it("marks a player disconnected after the grace period", async () => {
    const [host, guest] = (await lobbyOf(2)) as [TestClient, TestClient];
    guest.close();
    await waitFor(() => host.state?.view.players[1]?.connection === "reconnecting", "guest shown as reconnecting");
    expect(host.view.players[1]?.connected).toBe(true); // still counted as present during the grace period
    await waitFor(() => host.state?.view.players[1]?.connection === "offline", "guest shown as offline");
  });

  it("keeps one connection per player", async () => {
    const [, guest] = (await lobbyOf(2)) as [TestClient, TestClient];
    const tab = client();
    expectOk(await tab.call("room:resume", guest.session!));
    await waitFor(() => guest.replaced && !guest.socket.connected, "old tab closed");
    expectOk(await tab.call("chat:send", { text: "from the new tab" }));
  });

  it("removes a player who leaves the lobby", async () => {
    const [host, guest] = (await lobbyOf(2)) as [TestClient, TestClient];
    expectOk(await guest.call("room:leave", {}));
    await waitFor(() => guest.removed?.reason === "left", "removal notice");
    await waitFor(() => host.view.players.length === 1, "host sees one player");
    expectError(await guest.call("host:start", {}), "NOT_IN_ROOM");
  });

  it("creates rooms with a custom code and password, and joins through peek", async () => {
    const host = client();
    const created = expectOk(
      await host.call("room:create", { name: "Hosty", avatar: AVATAR, customCode: "fun-42", password: "letmein" }),
    );
    expect(created.roomCode).toBe("FUN42");
    expectError(await client().call("room:create", { name: "Copy", avatar: AVATAR, customCode: "FUN42" }), "CODE_TAKEN");
    expectError(await client().call("room:create", { name: "Rude", avatar: AVATAR, customCode: "FCUK" }), "CODE_INVALID");

    const guest = client();
    const preview = expectOk(await guest.call("room:peek", { roomCode: "fun42" }));
    expect(preview).toMatchObject({ roomCode: "FUN42", hasPassword: true, stage: "lobby", joinAs: "player", playerCount: 1 });
    expectError(await guest.call("room:join", { roomCode: "FUN42", name: "Gus", avatar: AVATAR }), "PASSWORD_REQUIRED");
    expectError(
      await guest.call("room:join", { roomCode: "FUN42", name: "Gus", avatar: AVATAR, password: "nope" }),
      "WRONG_PASSWORD",
    );
    expectError(
      await guest.call("room:join", { roomCode: "FUN42", name: "hosty", avatar: AVATAR, password: "letmein" }),
      "NAME_TAKEN",
    );
    guest.session = expectOk(
      await guest.call("room:join", { roomCode: "FUN42", name: "Gus", avatar: AVATAR, password: "letmein" }),
    );
    await waitFor(() => guest.state?.room.code === "FUN42" && guest.state.room.hasPassword, "guest state");
    expect(guest.view.players.map((p) => p.name)).toEqual(["Hosty", "Gus"]);
  });

  it("lets the host kick players and hand over hosting", async () => {
    const [host, a, b] = (await lobbyOf(3)) as [TestClient, TestClient, TestClient];
    expectError(await a.call("host:kick", { playerId: b.id }), "NOT_HOST");
    expectOk(await host.call("host:kick", { playerId: b.id }));
    await waitFor(() => b.removed?.reason === "kicked", "kick notice");
    expectError(await b.call("chat:send", { text: "still here?" }), "NOT_IN_ROOM");
    expectError(await client().call("room:resume", b.session!), "SESSION_INVALID");

    expectOk(await host.call("host:transfer", { playerId: a.id }));
    await waitFor(() => a.state?.view.you?.isHost === true, "new host");
    expectError(await host.call("host:start", {}), "NOT_HOST");
  });

  it("lets players change their nickname and avatar in the lobby", async () => {
    const [host, guest] = (await lobbyOf(2)) as [TestClient, TestClient];
    expectOk(await guest.call("player:updateProfile", { name: "Gwen", avatar: { color: "red", seed: "dragon" } }));
    await waitFor(() => host.state?.view.players[1]?.name === "Gwen", "renamed");
    expect(host.view.players[1]?.avatar).toEqual({ color: "red", seed: "dragon" });
    expectError(await guest.call("player:updateProfile", { name: "host" }), "NAME_TAKEN");
  });

  it("makes late joiners spectators", async () => {
    const players = await lobbyOf(5);
    const [host] = players as [TestClient];
    expectOk(await host.call("host:start", {}));
    const late = client();
    expect(expectOk(await late.call("room:peek", { roomCode: host.session!.roomCode })).joinAs).toBe("spectator");
    late.session = expectOk(
      await late.call("room:join", { roomCode: host.session!.roomCode, name: "Watcher", avatar: AVATAR }),
    );
    expect(late.session.seat).toBe("spectator");
    await waitFor(() => late.state?.view.you?.isSpectator === true, "spectator view");
    expectError(await late.call("game:ackRole", {}), "SPECTATOR");
    for (const role of late.rolesSeen()) expect(role).toBeUndefined();
  });

  it("gives a socket only one seat when joins overlap", async () => {
    const [host] = (await lobbyOf(1)) as [TestClient];
    const phone = client();
    const roomCode = host.session!.roomCode;
    const [first, second] = await Promise.all([
      phone.call("room:join", { roomCode, name: "Bo", avatar: AVATAR }),
      phone.call("room:join", { roomCode, name: "Bob", avatar: AVATAR }),
    ]);
    expect(first.ok && second.ok).toBe(true);
    await waitFor(() => host.state?.view.players.map((p) => p.name).join() === "Host,Bob", "only the last seat remains");
  });

  it("keeps your seat when a join to another room fails", async () => {
    const [host, guest] = (await lobbyOf(2)) as [TestClient, TestClient];
    expectError(await guest.call("room:join", { roomCode: "QQQQ", name: "Typo", avatar: AVATAR }), "ROOM_NOT_FOUND");
    expectOk(await guest.call("chat:send", { text: "still here" }));
    await waitFor(() => host.chat.some((m) => m.text === "still here"), "chat from kept seat");
    expect(host.view.players).toHaveLength(2);
  });

  it("logs room creation and game start for Render", () => {
    expect(logger.lines.some((l) => l.startsWith("INFO room.created"))).toBe(true);
    expect(logger.lines.some((l) => l.startsWith("INFO game.started") && l.includes("players=8"))).toBe(true);
  });
});
