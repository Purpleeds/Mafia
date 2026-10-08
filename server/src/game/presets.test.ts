import {
  MIN_PLAYERS,
  PRESETS,
  PRESET_IDS,
  defaultSettings,
  matchingPreset,
  presetPatch,
  type Avatar,
  type ContentMode,
  type PresetId,
} from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { BotManager } from "../dev/bots.js";
import { makeService } from "../rooms/testing/fakes.js";
import { mulberry32 } from "./index.js";
import { mergeSettings } from "./settings.js";

const AVATAR: Avatar = { color: "teal", seed: "fox" };

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("game presets", () => {
  it("are all accepted by the server's settings rules, unchanged", () => {
    for (const id of PRESET_IDS) {
      const merged = mergeSettings(defaultSettings(), presetPatch(id));
      expect(merged.ok, id).toBe(true);
      if (merged.ok) {
        expect(matchingPreset(merged.settings)).toBe(id);
        for (const [key, value] of Object.entries(PRESETS[id].settings)) {
          expect(merged.settings[key as keyof typeof merged.settings], `${id}.${key}`).toEqual(value);
        }
      }
    }
  });

  it("never change the mode, the Mafia's name, the chat filter or the AI narrator", () => {
    for (const mode of ["safe", "normal"] as ContentMode[]) {
      const start = { ...defaultSettings(), contentMode: mode, sneakyGang: true, profanityFilter: mode === "safe", aiNarrator: true };
      for (const id of PRESET_IDS) {
        const patch = presetPatch(id);
        for (const key of ["contentMode", "sneakyGang", "profanityFilter", "aiNarrator"]) expect(patch).not.toHaveProperty(key);
        const merged = mergeSettings(start, patch);
        expect(merged.ok).toBe(true);
        if (merged.ok) {
          expect(merged.settings.contentMode).toBe(mode);
          expect(merged.settings.sneakyGang).toBe(true);
          expect(merged.settings.aiNarrator).toBe(true);
        }
      }
    }
  });

  it("make the default settings the Classic preset", () => {
    expect(matchingPreset(defaultSettings())).toBe("classic");
  });

  it("are told apart from each other, and from customised settings", () => {
    const quick = mergeSettings(defaultSettings(), presetPatch("quick"));
    if (!quick.ok) throw new Error("bad");
    expect(matchingPreset(quick.settings)).toBe("quick");
    const tweaked = mergeSettings(quick.settings, { timers: { discussionSeconds: 60 } });
    if (!tweaked.ok) throw new Error("bad");
    expect(matchingPreset(tweaked.settings)).toBeNull();
    const ids = PRESET_IDS.map((id) => JSON.stringify(PRESETS[id].settings));
    expect(new Set(ids).size).toBe(PRESET_IDS.length);
  });

  it("are quick, classic and chaotic as promised", () => {
    const q = PRESETS.quick.settings.timers;
    const c = PRESETS.classic.settings.timers;
    for (const key of Object.keys(q) as (keyof typeof q)[]) expect(q[key]).toBeLessThanOrEqual(c[key]);
    expect(q.discussionSeconds).toBeLessThan(c.discussionSeconds / 2);
    expect(Object.values(PRESETS.chaos.settings.optionalRoles).every(Boolean)).toBe(true);
    expect(Object.values(PRESETS.classic.settings.optionalRoles).some(Boolean)).toBe(false);
    expect(PRESETS.chaos.minPlayers).toBe(MIN_PLAYERS + 1);
  });
});

describe("playing each preset", () => {
  async function play(id: PresetId, mode: ContentMode, players: number) {
    const env = makeService();
    const bots = new BotManager(env.service, env.store, env.logger, { rng: mulberry32(9), actChance: 0.9, chatChance: 0.2 });
    const host = must(await env.service.createRoom("Host", AVATAR));
    const code = host.roomCode;
    must(await env.service.act(code, { type: "UPDATE_SETTINGS", playerId: host.playerId, settings: { contentMode: mode } }));
    must(await env.service.act(code, { type: "UPDATE_SETTINGS", playerId: host.playerId, settings: presetPatch(id) }));
    must(await bots.addBots(code, host.playerId, players - 1));
    const started = await env.service.act(code, { type: "START_GAME", playerId: host.playerId });
    if (!started.ok) return { started, final: undefined };
    for (let step = 0; step < 500; step++) {
      const state = (await env.store.get(code))?.state;
      if (!state || state.phase === "GAME_OVER") break;
      if (state.phase === "ROLE_REVEAL") await env.service.act(code, { type: "ACK_ROLE", playerId: host.playerId });
      for (let i = 0; i < 3; i++) await bots.think(code);
      await env.fireTimer(code);
    }
    return { started, final: (await env.store.get(code))?.state };
  }

  for (const mode of ["safe", "normal"] as ContentMode[]) {
    for (const id of PRESET_IDS) {
      it(`plays ${id} in ${mode} mode from start to finish with ${PRESETS[id].minPlayers} players`, async () => {
        const { started, final } = await play(id, mode, PRESETS[id].minPlayers);
        expect(started.ok).toBe(true);
        expect(final?.phase).toBe("GAME_OVER");
        expect(final?.settings.contentMode).toBe(mode);
        if (id === "chaos") {
          const roles = new Set(final?.players.map((p) => p.role));
          for (const r of ["jester", "bodyguard", "cupid", "doctor", "detective", "mafia"]) expect(roles.has(r as never), r).toBe(true);
        }
      });
    }
  }

  it("tells the host Chaos needs one more player than the minimum", async () => {
    const { started } = await play("chaos", "safe", MIN_PLAYERS);
    expect(!started.ok && started.error.code).toBe("TOO_MANY_ROLES");
  });
});
