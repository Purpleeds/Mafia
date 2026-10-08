import { MAX_CHAT_LENGTH, type ChatMessage } from "@mafia/shared";
import type { GameState } from "../game/index.js";

export const MAX_CHAT_HISTORY = 200;

/** Strips control/invisible characters and collapses whitespace. Null if empty or too long. */
export function sanitizeChatText(raw: string): string | null {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0 || [...cleaned].length > MAX_CHAT_LENGTH) return null;
  return cleaned;
}

/**
 * Which stored messages a player is shown when they (re)join. Live delivery
 * uses the stricter phase-aware canRead(); history only needs to stop players
 * from seeing channels they were never part of.
 */
export function canSeeInHistory(state: GameState, playerId: string, message: ChatMessage): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  switch (message.channel) {
    case "public":
      return true;
    case "mafia":
      return player.role === "mafia";
    case "graveyard":
      return !player.alive && state.phase !== "LOBBY";
  }
}
