import type { ChatChannel } from "@mafia/shared";
import { findPlayer } from "./state.js";
import type { GameState } from "./types.js";

/**
 * Who can talk where. The server's chat layer should ask these before relaying
 * anything, so eliminated players can watch but never reach the living.
 *
 *  - public:    everyone in the lobby and after the game; living players during
 *               the day and the result screens; dead players may read, not write.
 *  - mafia:     living Mafia, at night only.
 *  - graveyard: eliminated players only, in any phase of a running game.
 */
export function canWrite(state: GameState, playerId: string, channel: ChatChannel): boolean {
  const player = findPlayer(state, playerId);
  if (!player) return false;
  const { phase } = state;
  const lobbyOrOver = phase === "LOBBY" || phase === "GAME_OVER";

  switch (channel) {
    case "public":
      if (lobbyOrOver) return true;
      if (!player.alive) return false;
      return phase !== "ROLE_REVEAL" && phase !== "NIGHT";
    case "mafia":
      return phase === "NIGHT" && player.alive && player.role === "mafia";
    case "graveyard":
      return !lobbyOrOver && !player.alive;
  }
}

export function canRead(state: GameState, playerId: string, channel: ChatChannel): boolean {
  const player = findPlayer(state, playerId);
  if (!player) return false;
  switch (channel) {
    case "public":
      return true; // spectators watch
    case "mafia":
      return canWrite(state, playerId, "mafia");
    case "graveyard":
      return state.phase !== "LOBBY" && state.phase !== "GAME_OVER" && !player.alive;
  }
}
