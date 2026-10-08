import type { ChatChannel } from "@mafia/shared";
import { findPlayer, findSpectator } from "./state.js";
import type { GameState } from "./types.js";

/**
 * Who can talk where. The server's chat layer should ask these before relaying
 * anything, so eliminated players can watch but never reach the living.
 *
 *  - public:    everyone in the lobby and after the game; living players during
 *               the day and the result screens; dead players may read, not write.
 *  - mafia:     living Mafia, at night only.
 *  - graveyard: eliminated players and spectators, in any phase of a running game.
 *
 * Spectators (late joiners) are treated like eliminated players: they watch the
 * public channel and talk in the graveyard, never to the living.
 */
export function canWrite(state: GameState, playerId: string, channel: ChatChannel): boolean {
  const { phase } = state;
  const lobbyOrOver = phase === "LOBBY" || phase === "GAME_OVER";
  if (findSpectator(state, playerId)) {
    if (channel === "public") return lobbyOrOver;
    return channel === "graveyard" && !lobbyOrOver;
  }
  const player = findPlayer(state, playerId);
  if (!player || player.kicked) return false;

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
  const inGame = state.phase !== "LOBBY" && state.phase !== "GAME_OVER";
  if (findSpectator(state, playerId)) return channel === "public" || (channel === "graveyard" && inGame);
  const player = findPlayer(state, playerId);
  if (!player || player.kicked) return false;
  switch (channel) {
    case "public":
      return true; // spectators watch
    case "mafia":
      return canWrite(state, playerId, "mafia");
    case "graveyard":
      return state.phase !== "LOBBY" && state.phase !== "GAME_OVER" && !player.alive;
  }
}
