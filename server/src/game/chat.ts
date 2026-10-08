import type { ChatChannel } from "@mafia/shared";
import { findPlayer, findSpectator } from "./state.js";
import type { GameState } from "./types.js";

/**
 * The one channel a member's messages go to right now, or null when chat is
 * locked for them. The client never chooses: this decides from the sender's
 * role, status (living, eliminated, spectator) and the phase.
 *
 *  - lobby / game over: everyone, public.
 *  - role reveal:       nobody.
 *  - night:             living Mafia in the Mafia channel; locked for everyone else.
 *  - day phases:        living players in public; eliminated players and
 *                       spectators in the graveyard, which the living can't see.
 */
export function chatChannelFor(state: GameState, memberId: string): ChatChannel | null {
  const { phase } = state;
  const spectator = findSpectator(state, memberId);
  const player = spectator ? undefined : findPlayer(state, memberId);
  if (!spectator && (!player || player.kicked)) return null;
  if (phase === "LOBBY" || phase === "GAME_OVER") return "public";
  if (phase === "ROLE_REVEAL") return null;
  if (phase === "NIGHT") return player && player.alive && player.role === "mafia" ? "mafia" : null;
  return player && player.alive ? "public" : "graveyard";
}

/**
 * Who can talk where. The server's chat layer should ask these before relaying
 * anything, so eliminated players can watch but never reach the living.
 *
 *  - public:    everyone in the lobby and after the game; living players during
 *               the day and the result screens; dead players may read, not write.
 *  - mafia:     living Mafia, at night only.
 *  - graveyard: eliminated players and spectators, by day (locked at night like everyone's).
 *
 * Spectators (late joiners) are treated like eliminated players: they watch the
 * public channel and talk in the graveyard, never to the living.
 */
export function canWrite(state: GameState, playerId: string, channel: ChatChannel): boolean {
  return chatChannelFor(state, playerId) === channel;
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
