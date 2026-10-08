import type { ContentMode, Phase, Winner } from "@mafia/shared";

export interface SceneTarget {
  mode: ContentMode;
  /** null outside a room (home and help pages). */
  phase: Phase | null;
  winner: Winner | null;
}

/** Where the sun (or moon) sits for each part of the game. */
export function dayForScene(scene: SceneTarget): number {
  switch (scene.phase) {
    case null:
      return 0.62; // golden afternoon over the village
    case "LOBBY":
      return scene.mode === "safe" ? 0.6 : 0.77;
    case "ROLE_REVEAL":
      return 0.84; // evening falls
    case "NIGHT":
      return 0.0; // midnight
    case "NIGHT_RESULTS":
      return 0.29; // dawn
    case "DAY_DISCUSSION":
      return 0.45;
    case "VOTING":
      return 0.63;
    case "VOTE_RESULTS":
      return 0.745; // sunset
    case "GAME_OVER":
      return scene.winner === "mafia" ? 0.93 : scene.winner === "jester" ? 0.75 : 0.38;
  }
}

/**
 * Where the time-of-day animation should end. Time moves forward (so the sun
 * sets and the moon rises), except for long jumps back, which would otherwise
 * spin through a whole extra day (e.g. switching the lobby's mode).
 */
export function nextDayValue(current: number, target: number): number {
  const now = ((current % 1) + 1) % 1;
  let delta = (((target - now) % 1) + 1) % 1;
  if (delta > 0.66) delta -= 1;
  return current + delta;
}

/** How long that change should take (ms): longer for bigger jumps. */
export function dayTransitionMs(delta: number): number {
  return Math.round(1200 + Math.min(1, Math.abs(delta)) * 6000);
}
