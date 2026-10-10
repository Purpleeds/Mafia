import type { Avatar, BotListenRequestPayload, BotSpeechRequestPayload, SettingsPatch } from "@mafia/shared";
import { mulberry32 } from "../../game/index.js";
import { makeService } from "../../rooms/testing/fakes.js";
import { parseMessage } from "../heard.js";
import { BotManager, type BotManagerOptions } from "../manager.js";

export const AVATAR: Avatar = { color: "teal", seed: "fox" };

export function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** What a fake host AI answers: messages/events, null ("couldn't"), or "silent" (never answers). */
export interface FakeAi {
  /** How long it takes to answer (ms). */
  latency?: number;
  write?: (payload: BotSpeechRequestPayload) => Array<{ id: string; text: string }> | null | "silent";
  read?: (payload: BotListenRequestPayload) => unknown[] | null | "silent";
}

/** A well-behaved AI: keeps every bot line as it is, and reads the chat like the keyword reader would. */
export const GOOD_AI: Required<Pick<FakeAi, "write" | "read">> = {
  write: (payload) => payload.intents.map((i) => ({ id: i.id, text: i.says })),
  read: (payload) => {
    const players = payload.players.map((name) => ({ id: name, name }));
    return payload.messages.flatMap((m) =>
      parseMessage({ id: String(m.n), senderId: m.from, text: m.text, sentAt: 0 }, players).map((e) => {
        const { messageId, speakerId, at, byBot, replyTo, kind, ...rest } = e;
        void messageId;
        void speakerId;
        void at;
        void byBot;
        void replyTo;
        const fields = rest as Record<string, unknown>;
        const out: Record<string, unknown> = { msg: m.n, type: kind };
        for (const [k, v] of Object.entries(fields)) out[k.replace(/Id$/, "").replace("votedFor", "voted_for")] = v;
        return out;
      }),
    );
  },
};

/**
 * A room service with real bots on a fake clock. `step()` jumps to whatever
 * happens next (a bot's move, the room's timer, or the fake host AI's answer)
 * and does it, so whole games play out in milliseconds with the real,
 * human-like bot delays.
 */
export function botTable(seed = 1, options: Partial<Omit<BotManagerOptions, "port" | "logger">> & { ai?: FakeAi } = {}) {
  const { ai, ...botOptions } = options;
  const env = makeService({ rng: mulberry32(seed) });
  const bots = new BotManager({
    port: env.service,
    logger: env.logger,
    now: () => env.clock.now,
    random: mulberry32(seed * 7 + 1),
    ...botOptions,
  });
  env.service.attachBots(bots);

  /** Bot moves taken (actions and messages queued), with when they happened (for the timing tests). */
  const moves: Array<{ at: number; seat: string; type: string }> = [];
  const original = env.service.botAct.bind(env.service);
  env.service.botAct = async (code, seat, action) => {
    moves.push({ at: env.clock.now, seat, type: action.type });
    return original(code, seat, action);
  };
  const said = env.service.botSay.bind(env.service);
  env.service.botSay = async (code, seat, intent) => {
    const result = await said(code, seat, intent);
    moves.push({ at: env.clock.now, seat, type: result.ok ? `SAY:${intent.act}` : `SAY_REJECTED:${result.error.code}` });
    return result;
  };

  // The fake host AI: answers each request after its latency.
  const answers: Array<{ at: number; run: () => Promise<unknown> }> = [];
  if (ai) {
    const latency = ai.latency ?? 1500;
    const speech = env.broadcaster.botSpeechRequest.bind(env.broadcaster);
    env.broadcaster.botSpeechRequest = (room, player, payload) => {
      speech(room, player, payload);
      const reply = (ai.write ?? GOOD_AI.write)(payload);
      if (reply === "silent") return;
      answers.push({ at: env.clock.now + latency, run: () => env.service.submitBotSpeech(room, player, payload.requestId, reply) });
    };
    const listen = env.broadcaster.botListenRequest.bind(env.broadcaster);
    env.broadcaster.botListenRequest = (room, player, payload) => {
      listen(room, player, payload);
      const reply = (ai.read ?? GOOD_AI.read)(payload);
      if (reply === "silent") return;
      answers.push({ at: env.clock.now + latency, run: () => env.service.submitBotListen(room, player, payload.requestId, reply) });
    };
  }

  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };

  async function step(code: string): Promise<boolean> {
    const timers = [...env.scheduler.timers.entries()].filter(([key]) => key === code || key.startsWith(`${code}:`));
    const nextTimer = timers.reduce<[string, number] | null>((acc, [key, t]) => (acc === null || t.at < acc[1] ? [key, t.at] : acc), null);
    const due = bots.nextDue();
    const answer = answers.reduce<{ at: number; index: number } | null>((acc, a, index) => (acc === null || a.at < acc.at ? { at: a.at, index } : acc), null);
    const candidates = [due, nextTimer?.[1] ?? null, answer?.at ?? null].filter((x): x is number => x !== null);
    if (candidates.length === 0) return false;
    const at = Math.min(...candidates);
    if (answer && answer.at === at) {
      env.clock.now = Math.max(env.clock.now, at);
      const [next] = answers.splice(answer.index, 1);
      await next?.run();
      await settle();
      return true;
    }
    if (due !== null && due === at) {
      env.clock.now = Math.max(env.clock.now, due);
      await bots.tick();
      await settle();
      return true;
    }
    if (nextTimer) {
      const timer = env.scheduler.timers.get(nextTimer[0]);
      env.clock.now = Math.max(env.clock.now, nextTimer[1]);
      env.scheduler.timers.delete(nextTimer[0]);
      timer?.fn();
      // Let the timer's async work (the room lock) finish.
      await settle();
      return true;
    }
    return false;
  }

  /** Steps until `done()` says so (or nothing is left to happen). */
  async function runUntil(code: string, done: () => Promise<boolean> | boolean, maxSteps = 8000): Promise<number> {
    for (let i = 0; i < maxSteps; i++) {
      if (await done()) return i;
      if (!(await step(code))) return i;
    }
    throw new Error("the game didn't finish");
  }

  async function state(code: string) {
    return (await env.store.get(code))?.state;
  }

  /** A room with a real host, the given settings, and bots filled to `players`. */
  async function room(players: number, settings: SettingsPatch = {}) {
    const host = must(await env.service.createRoom("Host", AVATAR));
    const code = host.roomCode;
    if (Object.keys(settings).length > 0) {
      must(await env.service.act(code, { type: "UPDATE_SETTINGS", playerId: host.playerId, settings }));
    }
    while (((await state(code))?.players.length ?? 0) < players) must(await env.service.addBot(code, host.playerId));
    return { code, hostId: host.playerId };
  }

  return { env, bots, moves, step, runUntil, state, room };
}
