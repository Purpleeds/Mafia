import { AVATAR_POLICIES, CHAT_FILTERS, modeDefaults } from "@mafia/shared";
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

  if (typeof state.gameNumber !== "number") state.gameNumber = state.phase === "LOBBY" ? 0 : 1;
  if (state.paused === undefined) state.paused = null;
  if (!Array.isArray(state.discussionDone)) state.discussionDone = [];
  if (!Array.isArray(state.log)) state.log = [];
  for (const p of state.players) {
    if (typeof p.ready !== "boolean") p.ready = false;
  }
}
