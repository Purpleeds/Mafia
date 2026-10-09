/**
 * A browser stand-in for socket tests: connects with socket.io-client and
 * records everything the server sends it.
 */
import { expect } from "vitest";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import type {
  Avatar,
  AvatarImagesPayload,
  ChatMessage,
  ClientEventName,
  ClientToServerEvents,
  GameStatePayload,
  RemovedPayload,
  Role,
  RoomNoticePayload,
  ServerToClientEvents,
  SessionInfo,
} from "@mafia/shared";

export type AckOf<E extends ClientEventName> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];

export const AVATAR: Avatar = { color: "violet", seed: "owl" };

/** A browser stand-in that records everything the server sends it. */
export class TestClient {
  readonly socket: ClientSocket<ServerToClientEvents, ClientToServerEvents>;
  readonly received: Array<{ event: string; payload: unknown }> = [];
  state: GameStatePayload | null = null;
  chat: ChatMessage[] = [];
  removed: RemovedPayload | null = null;
  /** Avatar pictures received: id -> data URL. */
  images = new Map<string, string>();
  notices: RoomNoticePayload[] = [];
  replaced = false;
  session: SessionInfo | null = null;

  constructor(url: string) {
    this.socket = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
    this.socket.onAny((event: string, payload: unknown) => this.received.push({ event, payload }));
    this.socket.on("game:state", (p) => {
      if (!this.state || p.version >= this.state.version) this.state = p;
    });
    this.socket.on("chat:message", (m) => this.chat.push(m));
    this.socket.on("avatar:images", (p: AvatarImagesPayload) => {
      for (const image of p.images) this.images.set(image.id, image.dataUrl);
    });
    this.socket.on("room:notice", (p) => this.notices.push(p));
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

export async function waitFor(check: () => boolean, label = "condition", ms = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export function expectOk<T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.data;
}

export function expectError(result: { ok: boolean; error?: { code: string } }, code: string): void {
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe(code);
}


/** Creates a room as `host` and has the others join it; returns everyone's sessions. */
export async function roomWith(host: TestClient, others: TestClient[], names = ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay"]) {
  const [hostName = "Host", ...rest] = names;
  host.session = expectOk(await host.call("room:create", { name: hostName, avatar: AVATAR }));
  const code = host.session.roomCode;
  for (const [i, c] of others.entries()) {
    c.session = expectOk(await c.call("room:join", { roomCode: code, name: rest[i] ?? `P${i}`, avatar: AVATAR }));
  }
  await waitFor(() => [host, ...others].every((c) => c.state !== null), "everyone's first state");
  return code;
}
