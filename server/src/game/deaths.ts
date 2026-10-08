import type { DeathRecord, GameState } from "./types.js";
import { findPlayer } from "./state.js";

/**
 * Marks players dead and adds the broken-heart death of a linked partner.
 * Returns every death that actually happened, in order.
 */
export function killPlayers(state: GameState, initial: DeathRecord[]): DeathRecord[] {
  const deaths: DeathRecord[] = [];
  const kill = (playerId: string, cause: DeathRecord["cause"]) => {
    const player = findPlayer(state, playerId);
    if (!player || !player.alive) return;
    player.alive = false;
    deaths.push({ playerId, cause });
  };

  for (const d of initial) kill(d.playerId, d.cause);

  if (state.lovers) {
    const [a, b] = state.lovers;
    const died = new Set(deaths.map((d) => d.playerId));
    if (died.has(a)) kill(b, "heartbreak");
    if (died.has(b)) kill(a, "heartbreak");
  }
  return deaths;
}
