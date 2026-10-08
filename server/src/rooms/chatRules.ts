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
 * Which stored messages someone is shown when they (re)join. Live delivery uses
 * the engine's phase-aware canRead(); history follows the same membership rules:
 * Mafia chat only for living Mafia, the graveyard only for the eliminated and
 * spectators while a game runs.
 */
export function canSeeInHistory(state: GameState, memberId: string, message: ChatMessage): boolean {
  const inGame = state.phase !== "LOBBY" && state.phase !== "GAME_OVER";
  if (state.spectators.some((s) => s.id === memberId)) {
    return message.channel === "public" || (message.channel === "graveyard" && inGame);
  }
  const player = state.players.find((p) => p.id === memberId);
  if (!player || player.kicked) return false;
  switch (message.channel) {
    case "public":
      return true;
    case "mafia":
      return player.role === "mafia" && player.alive;
    case "graveyard":
      return !player.alive && inGame;
  }
}
