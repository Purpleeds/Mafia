import type { Winner } from "@mafia/shared";
import type { GameState } from "./types.js";

/**
 * Town wins when no Mafia are left. Mafia win when they equal or outnumber
 * everyone else still alive (the Jester counts as "everyone else").
 * The Jester's win (being voted out) is decided in the voting code.
 */
export function evaluateWinner(state: GameState): Winner | null {
  const living = state.players.filter((p) => p.alive);
  const mafia = living.filter((p) => p.role === "mafia").length;
  const others = living.length - mafia;
  if (mafia === 0) return "town";
  if (mafia >= others) return "mafia";
  return null;
}
