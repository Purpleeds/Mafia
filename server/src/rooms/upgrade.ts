import { AVATAR_POLICIES, BOT_DIFFICULTIES, CHAT_FILTERS, defaultSettings, modeDefaults } from "@mafia/shared";
import { cleanPersonality } from "../bots/personality.js";
import type { Room } from "./types.js";

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * Brings a room saved by an older version of the server (e.g. one kept in Key
 * Value across a deploy) up to today's shape, in place. Missing fields get
 * their defaults; the old on/off chat filter becomes a filter level.
 */
export function upgradeRoom(room: Room): void {
  const state = room.state as Room["state"] & Record<string, unknown>;
  const settings = state.settings as Room["state"]["settings"] & { profanityFilter?: unknown };
  const defaults = modeDefaults(settings.contentMode);

  if (!isOneOf(CHAT_FILTERS, settings.chatFilter)) {
    settings.chatFilter =
      settings.contentMode === "safe" ? "strict" : settings.profanityFilter === false ? "uncensored" : defaults.chatFilter;
  }
  if (settings.contentMode === "safe") settings.chatFilter = "strict";
  delete settings.profanityFilter;
  if (!isOneOf(AVATAR_POLICIES, settings.customAvatars)) settings.customAvatars = defaults.customAvatars;
  const base = defaultSettings();
  if (!isOneOf(BOT_DIFFICULTIES, settings.botDifficulty)) settings.botDifficulty = base.botDifficulty;
  for (const key of ["soloPractice", "replaceBots", "botTakeover", "aiBotChat"] as const) {
    if (typeof settings[key] !== "boolean") settings[key] = base[key];
  }
  if (room.botTarget === undefined) room.botTarget = null;
  if (room.gameStartedAt === undefined) room.gameStartedAt = null;
  const profiles = (room.botProfiles ?? {}) as Record<string, unknown>;
  room.botProfiles = {};
  for (const p of room.state.players) {
    if (p.isBot) room.botProfiles[p.id] = cleanPersonality(profiles[p.id], p.id);
  }

  if (typeof state.gameNumber !== "number") state.gameNumber = state.phase === "LOBBY" ? 0 : 1;
  if (state.paused === undefined) state.paused = null;
  if (!Array.isArray(state.discussionDone)) state.discussionDone = [];
  if (!Array.isArray(state.log)) state.log = [];
  for (const p of state.players) {
    if (typeof p.ready !== "boolean") p.ready = false;
    if (typeof p.isBot !== "boolean") p.isBot = false;
    if (typeof p.botControlled !== "boolean") p.botControlled = false;
  }
}
