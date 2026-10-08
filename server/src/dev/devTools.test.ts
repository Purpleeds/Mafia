import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { NARRATION_TIMEOUT_MS, type Avatar, type DevDebugSnapshot, type GameStatePayload, type SessionInfo } from "@mafia/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createMafiaServer, type MafiaServerInstance } from "../app.js";
import { getGameView, mulberry32 } from "../game/index.js";
import { createMemoryLogger } from "../logger.js";
import { makeService } from "../rooms/testing/fakes.js";
import { BOT_FILL_TARGET, BotManager } from "./bots.js";
import { DevTools, devToolsEnabled } from "./devTools.js";

const AVATAR: Avatar = { color: "teal", seed: "fox" };

type Env = ReturnType<typeof makeService>;

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function setup(seed = 11, options: Partial<ConstructorParameters<typeof BotManager>[3]> = {}) {
  const env = makeService();
  const bots = new BotManager(env.service, env.store, env.logger, { rng: mulberry32(seed), ...options });
  return { env, bots };
}

async function newRoom(env: Env) {
  const host = must(await env.service.createRoom("Host", AVATAR));
  return { code: host.roomCode, hostId: host.playerId };
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

describe("adding bots", () => {
  it("fills the lobby to the target with ordinary players", async () => {
    const { env, bots } = setup();
    const { code, hostId } = await newRoom(env);
    const result = must(await bots.addBots(code, hostId));
    expect(result).toEqual({ added: BOT_FILL_TARGET - 1, players: BOT_FILL_TARGET });
    const state = (await env.store.get(code))?.state;
    expect(state?.players).toHaveLength(BOT_FILL_TARGET);
    expect(state?.players.every((p) => p.connected && p.alive)).toBe(true);
    const names = state?.players.map((p) => p.name) ?? [];
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n.startsWith("Bot "))).toHaveLength(BOT_FILL_TARGET - 1);
    expect(bots.botIds(code)).toHaveLength(BOT_FILL_TARGET - 1);
    expect(state?.hostId).toBe(hostId);
  });

  it("adds an exact number, never beyond the room's limit, and fills only up to the target", async () => {
    const { env, bots } = setup();
    const { code, hostId } = await newRoom(env);
    expect(must(await bots.addBots(code, hostId, 2))).toEqual({ added: 2, players: 3 });
    expect(must(await bots.addBots(code, hostId))).toEqual({ added: BOT_FILL_TARGET - 3, players: BOT_FILL_TARGET });
    expect(must(await bots.addBots(code, hostId))).toEqual({ added: 0, players: BOT_FILL_TARGET });
    expect(must(await bots.addBots(code, hostId, 50)).players).toBe(20);
    const bad = await bots.addBots(code, hostId, -1);
    expect(bad.ok).toBe(false);
  });

  it("is for the host and the lobby only", async () => {
    const { env, bots } = setup();
    const { code, hostId } = await newRoom(env);
    const guest = must(await env.service.joinRoom(code, "Guest", AVATAR));
    const notHost = await bots.addBots(code, guest.playerId);
    expect(!notHost.ok && notHost.error.code).toBe("NOT_HOST");
    must(await bots.addBots(code, hostId));
    must(await env.service.act(code, { type: "START_GAME", playerId: hostId }));
    const late = await bots.addBots(code, hostId, 1);
    expect(!late.ok && late.error.code).toBe("WRONG_PHASE");
    const gone = await bots.addBots("ZZZZ", hostId);
    expect(!gone.ok && gone.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("joins password-protected rooms too", async () => {
    const { env, bots } = setup();
    const { code, hostId } = await newRoom(env);
    must(await env.service.setPassword(code, hostId, "secret123"));
    expect(must(await bots.addBots(code, hostId, 2)).added).toBe(2);
  });
});

describe("a game of bots", () => {
  async function play(options: { settings?: Record<string, unknown>; narrationAnswer?: "silent" | "null" } = {}) {
    const { env, bots } = setup(5, { actChance: 0.9, chatChance: 0.5 });
    const { code, hostId } = await newRoom(env);
    must(await bots.addBots(code, hostId));
    if (options.settings) must(await env.service.act(code, { type: "UPDATE_SETTINGS", playerId: hostId, settings: options.settings }));
    must(await env.service.act(code, { type: "START_GAME", playerId: hostId }));

    const sources = new Set<string | null | undefined>();
    const phases = new Set<string>();
    const asked = new Set<string>();
    for (let step = 0; step < 400; step++) {
      const room = await env.store.get(code);
      const state = room?.state;
      if (!state || state.phase === "GAME_OVER") break;
      phases.add(state.phase);
      // The human host: acknowledges their role, otherwise leaves it to the timers.
      if (state.phase === "ROLE_REVEAL") await env.service.act(code, { type: "ACK_ROLE", playerId: hostId });
      for (let i = 0; i < 3; i++) await bots.think(code);
      // The host's browser: asked to write, answers nothing, or answers "I couldn't".
      for (const request of env.broadcaster.narrationRequests()) {
        if (asked.has(request.payload.requestId)) continue;
        asked.add(request.payload.requestId);
        if (options.narrationAnswer === "null") {
          must(await env.service.submitNarration(code, hostId, request.payload.requestId, null));
        }
      }
      const view = getGameView((await env.store.get(code))?.state ?? state, hostId);
      if (view.narration?.status === "ready") sources.add(view.narration.source);
      await env.fireTimer(code);
    }
    const final = (await env.store.get(code))?.state;
    return { env, bots, code, hostId, final, sources, phases, asked };
  }

  it("plays from the lobby to the end with no rejected move", async () => {
    const { final, phases, env } = await play();
    expect(final?.phase).toBe("GAME_OVER");
    expect(final?.winner).not.toBeNull();
    for (const phase of ["ROLE_REVEAL", "NIGHT", "NIGHT_RESULTS", "DAY_DISCUSSION", "VOTING", "VOTE_RESULTS"]) {
      expect(phases.has(phase), phase).toBe(true);
    }
    expect(env.logger.lines.filter((l) => l.includes("dev.bot_failed"))).toEqual([]);
  });

  it("takes the actions the server offers: night powers, votes, ready-ups", async () => {
    const { final } = await play();
    // Someone left the game during the play (the Mafia's picks or a vote), so actions were taken and accepted.
    expect(final?.players.some((p) => !p.alive)).toBe(true);
  });

  it("chats in the right channels, and only where the server allows it", async () => {
    const { env, code, bots } = await play();
    const room = await env.store.get(code);
    const messages = room?.chat ?? [];
    expect(messages.length).toBeGreaterThan(3);
    const botIds = new Set(bots.botIds(code));
    for (const m of messages.filter((x) => botIds.has(x.senderId))) {
      expect(["public", "mafia", "graveyard"]).toContain(m.channel);
      if (m.channel === "mafia") {
        const sender = room?.state.players.find((p) => p.id === m.senderId);
        expect(sender?.role).toBe("mafia");
      }
    }
    expect(messages.some((m) => m.reaction)).toBe(true);
  });

  it("falls back to ready-made narration when the host never signed in to Puter (AI on, no answer)", async () => {
    const { final, sources, asked } = await play({ settings: { aiNarrator: true } });
    expect(final?.phase).toBe("GAME_OVER");
    expect(asked.size).toBeGreaterThan(1); // the host's browser was asked each time...
    expect(sources.size).toBeGreaterThan(0);
    expect([...sources]).toEqual(["template"]); // ...and every announcement still came from a template
    // The only wait was the 6 s limit.
    expect(NARRATION_TIMEOUT_MS).toBe(6000);
  });

  it("falls back at once when Puter answers with a failure", async () => {
    const { final, sources } = await play({ settings: { aiNarrator: true }, narrationAnswer: "null" });
    expect(final?.phase).toBe("GAME_OVER");
    expect([...sources]).toEqual(["template"]);
  });

  it("works with the AI narrator off, the default", async () => {
    const { env, final, asked } = await play();
    expect(final?.phase).toBe("GAME_OVER");
    expect(asked.size).toBe(0);
    expect(env.broadcaster.narrationRequests()).toEqual([]);
  });
});

describe("the debug snapshot", () => {
  it("shows the whole state, roles included, to a member only", async () => {
    const env = makeService();
    const tools = new DevTools({ service: env.service, store: env.store, logger: env.logger, clock: () => env.clock.now, rng: mulberry32(2) });
    const { code, hostId } = await newRoom(env);
    must(await tools.bots.addBots(code, hostId));
    must(await env.service.act(code, { type: "START_GAME", playerId: hostId }));
    const snap = must(await tools.debugSnapshot(code, hostId));
    const state = snap.state as { players: Array<{ role: string | null }>; phase: string };
    expect(state.phase).toBe("ROLE_REVEAL");
    expect(state.players.every((p) => p.role !== null)).toBe(true);
    expect(snap.botIds).toHaveLength(BOT_FILL_TARGET - 1);
    expect(snap.members).toBe(BOT_FILL_TARGET);
    expect(snap.timerAt).toBeGreaterThan(snap.serverNow);
    const stranger = await tools.debugSnapshot(code, "nobody");
    expect(!stranger.ok && stranger.error.code).toBe("NOT_IN_ROOM");
    const none = await tools.debugSnapshot("ZZZZ", hostId);
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

  it("answers the dev events in development: fill, then show the full state", async () => {
    const url = await start(true);
    expect(await (await fetch(`${url}/dev-config`)).json()).toEqual({ dev: true });
    const { socket, states } = await host(url);
    const filled = (await socket.emitWithAck("dev:fillBots", {})) as { ok: true; data: { added: number; players: number } };
    expect(filled.ok && filled.data).toEqual({ added: BOT_FILL_TARGET - 1, players: BOT_FILL_TARGET });
    await new Promise((r) => setTimeout(r, 100));
    expect(states.at(-1)?.view.players).toHaveLength(BOT_FILL_TARGET);
    const bad = (await socket.emitWithAck("dev:fillBots", { count: "many" })) as { ok: false; error: { code: string } };
    expect(bad.error.code).toBe("BAD_REQUEST");
    const debug = (await socket.emitWithAck("dev:debugState", {})) as { ok: true; data: DevDebugSnapshot };
    expect(debug.ok && debug.data.botIds.length).toBe(BOT_FILL_TARGET - 1);
  });

  it("does not know the dev events in production, and says dev is off", async () => {
    const url = await start(false);
    expect(await (await fetch(`${url}/dev-config`)).json()).toEqual({ dev: false });
    const { socket, states } = await host(url);
    const filled = (await socket.emitWithAck("dev:fillBots", {})) as { ok: false; error: { code: string; message: string } };
    expect(filled.ok).toBe(false);
    expect(filled.error.message).toBe("Unknown event.");
    const debug = (await socket.emitWithAck("dev:debugState", {})) as { ok: false; error: { message: string } };
    expect(debug.error.message).toBe("Unknown event.");
    expect(states.at(-1)?.view.players).toHaveLength(1);
    expect(server?.devTools).toBeNull();
  });
});
