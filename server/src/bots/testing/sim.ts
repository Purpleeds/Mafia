import type { Avatar, SettingsPatch } from "@mafia/shared";
import { mulberry32 } from "../../game/index.js";
import { makeService } from "../../rooms/testing/fakes.js";
import { BotManager, type BotManagerOptions } from "../manager.js";

export const AVATAR: Avatar = { color: "teal", seed: "fox" };

export function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/**
 * A room service with real bots on a fake clock. `step()` jumps to whatever
 * happens next (a bot's move or the room's timer) and does it, so whole games
 * play out in milliseconds with the real, human-like bot delays.
 */
export function botTable(seed = 1, options: Partial<Omit<BotManagerOptions, "port" | "logger">> = {}) {
  const env = makeService({ rng: mulberry32(seed) });
  const bots = new BotManager({
    port: env.service,
    logger: env.logger,
    now: () => env.clock.now,
    random: mulberry32(seed * 7 + 1),
    ...options,
  });
  env.service.attachBots(bots);

  /** Bot moves taken, with when they happened (for the timing tests). */
  const moves: Array<{ at: number; seat: string; type: string }> = [];
  const original = env.service.botAct.bind(env.service);
  env.service.botAct = async (code, seat, action) => {
    moves.push({ at: env.clock.now, seat, type: action.type });
    return original(code, seat, action);
  };

  async function step(code: string): Promise<boolean> {
    const timers = [...env.scheduler.timers.entries()].filter(([key]) => key === code || key.startsWith(`${code}:`));
    const nextTimer = timers.reduce<[string, number] | null>((acc, [key, t]) => (acc === null || t.at < acc[1] ? [key, t.at] : acc), null);
    const due = bots.nextDue();
    if (due !== null && (nextTimer === null || due <= nextTimer[1])) {
      env.clock.now = Math.max(env.clock.now, due);
      await bots.tick();
      return true;
    }
    if (nextTimer) {
      const timer = env.scheduler.timers.get(nextTimer[0]);
      env.clock.now = Math.max(env.clock.now, nextTimer[1]);
      env.scheduler.timers.delete(nextTimer[0]);
      timer?.fn();
      // Let the timer's async work (the room lock) finish.
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      return true;
    }
    return false;
  }

  /** Steps until `done()` says so (or nothing is left to happen). */
  async function runUntil(code: string, done: () => Promise<boolean> | boolean, maxSteps = 5000): Promise<number> {
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
