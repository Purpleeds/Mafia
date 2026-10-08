/** The countdown's last seconds: which seconds tick, and which tick sharply. */

/** Ticks play for the last 10 seconds of a phase (10, 9, ... 1). */
export const TICK_SECONDS = 10;
/** The last three ticks are higher and firmer. */
export const URGENT_SECONDS = 3;

/** Whether a countdown showing `secondsLeft` should tick, and how. */
export function tickFor(secondsLeft: number): "tick" | "tickUrgent" | null {
  if (!Number.isFinite(secondsLeft) || secondsLeft < 1 || secondsLeft > TICK_SECONDS) return null;
  return secondsLeft <= URGENT_SECONDS ? "tickUrgent" : "tick";
}
