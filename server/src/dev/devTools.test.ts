import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import type { Avatar, BotCountResult, DevDebugSnapshot, GameStatePayload, SessionInfo } from "@mafia/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createMafiaServer, type MafiaServerInstance } from "../app.js";
import { createMemoryLogger } from "../logger.js";
import { makeService } from "../rooms/testing/fakes.js";
import { DevTools, devToolsEnabled } from "./devTools.js";

const AVATAR: Avatar = { color: "teal", seed: "fox" };

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("when dev tools are on", () => {
  it("is on locally and off in production, whichever way production is detected", () => {
    expect(devToolsEnabled({})).toBe(true);
    expect(devToolsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(devToolsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devToolsEnabled({ RENDER: "true" })).toBe(false);
    expect(devToolsEnabled({ NODE_ENV: "development", RENDER: "true" })).toBe(false);
  });
});

describe("the debug snapshot", () => {
  it("shows the whole state, roles included, to a member only", async () => {
    const env = makeService();
    const tools = new DevTools({ store: env.store, clock: () => env.clock.now });
    const host = must(await env.service.createRoom("Host", AVATAR));
    const code = host.roomCode;
    must(await env.service.act(code, { type: "UPDATE_SETTINGS", playerId: host.playerId, settings: { soloPractice: true } }));
    must(await env.service.fillBots(code, host.playerId));
    must(await env.service.act(code, { type: "START_GAME", playerId: host.playerId }));
    const snap = must(await tools.debugSnapshot(code, host.playerId));
    const state = snap.state as { players: Array<{ role: string | null }>; phase: string };
    expect(state.phase).toBe("ROLE_REVEAL");
    expect(state.players.every((p) => p.role !== null)).toBe(true);
    expect(snap.botIds).toHaveLength(4);
    expect(snap.members).toBe(5);
    expect(snap.timerAt).toBeGreaterThan(snap.serverNow);
    const stranger = await tools.debugSnapshot(code, "nobody");
    expect(!stranger.ok && stranger.error.code).toBe("NOT_IN_ROOM");
    const none = await tools.debugSnapshot("ZZZZ", host.playerId);
    expect(!none.ok && none.error.code).toBe("ROOM_NOT_FOUND");
  });
});

describe("over real sockets", () => {
  let server: MafiaServerInstance | undefined;
  const sockets: Socket[] = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.close();
    await server?.close();
    server = undefined;
  });

  async function start(devTools: boolean): Promise<string> {
    server = createMafiaServer({ clientDist: null, logger: createMemoryLogger(), devTools });
    await new Promise<void>((resolve) => server?.httpServer.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  }

  async function host(url: string) {
    const socket = connect(url, { transports: ["websocket"] });
    sockets.push(socket);
    const states: GameStatePayload[] = [];
    socket.on("game:state", (p: GameStatePayload) => states.push(p));
    const created = (await socket.emitWithAck("room:create", { name: "Host", avatar: AVATAR })) as { ok: true; data: SessionInfo };
    return { socket, states, session: created.data };
  }

  it("answers the debug event in development, and bots are a normal host feature", async () => {
    const url = await start(true);
    expect(await (await fetch(`${url}/dev-config`)).json()).toEqual({ dev: true });
    const { socket, states } = await host(url);
    const filled = (await socket.emitWithAck("host:fillBots", {})) as { ok: true; data: BotCountResult };
    expect(filled.ok && filled.data).toEqual({ bots: 4, players: 5 });
    await new Promise((r) => setTimeout(r, 100));
    expect(states.at(-1)?.view.players.filter((p) => p.isBot)).toHaveLength(4);
    const debug = (await socket.emitWithAck("dev:debugState", {})) as { ok: true; data: DevDebugSnapshot };
    expect(debug.ok && debug.data.botIds.length).toBe(4);
  });

  it("keeps the debug panel out of production, but bots work there too", async () => {
    const url = await start(false);
    expect(await (await fetch(`${url}/dev-config`)).json()).toEqual({ dev: false });
    const { socket, states } = await host(url);
    const debug = (await socket.emitWithAck("dev:debugState", {})) as { ok: false; error: { message: string } };
    expect(debug.error.message).toBe("Unknown event.");
    const old = (await socket.emitWithAck("dev:fillBots", {})) as { ok: false; error: { message: string } };
    expect(old.error.message).toBe("Unknown event.");
    const added = (await socket.emitWithAck("host:addBot", {})) as { ok: true; data: BotCountResult };
    expect(added.ok && added.data).toEqual({ bots: 1, players: 2 });
    await new Promise((r) => setTimeout(r, 100));
    expect(states.at(-1)?.view.players).toHaveLength(2);
    expect(server?.devTools).toBeNull();
  });
});
