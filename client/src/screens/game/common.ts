import type { GameView, PublicPlayerView } from "@mafia/shared";
import { remainingMs } from "../../components/Countdown";
import type { ReceivedState } from "../../state/store";

export interface PhaseProps {
  received: ReceivedState;
}

/** A member's name, with "(Bot)" after a bot's, so it reads right in any sentence or label. */
export function nameOf(view: GameView, id: string): string {
  const player = view.players.find((p) => p.id === id);
  if (player) return player.isBot ? `${player.name} (Bot)` : player.name;
  return view.spectators.find((s) => s.id === id)?.name ?? "Someone";
}

/** You as a player in this game (not a spectator), if you are one. */
export function myPlayer(view: GameView): PublicPlayerView | null {
  const you = view.you;
  if (!you || you.isSpectator) return null;
  return view.players.find((p) => p.id === you.id) ?? null;
}

/** Small stable number from text (picks the decoy prompt without randomness during render). */
export function hashText(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Typing speed (ms per character) for the narrator: the usual pace, but quick enough to
 * finish in about half of what's left of the phase, so a short timer never cuts the news off.
 */
export function typingSpeed(received: ReceivedState, textLength: number): number {
  const { view, serverNow } = received.payload;
  if (view.phaseEndsAt === null || textLength === 0) return 32;
  const left = remainingMs(view.phaseEndsAt, serverNow, received.receivedAt, performance.now());
  return Math.max(6, Math.min(32, Math.floor((left * 0.5) / textLength)));
}
