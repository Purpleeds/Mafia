import { getPrefs } from "./prefs";

/**
 * Short vibrations on phones that support them (Android browsers; iPhones
 * ignore them).
 *
 * Privacy rule: a buzz must never tell the people sitting nearby anything
 * about your role. So there are only two kinds:
 *  - "phase": a new phase began. Every device in the room buzzes at the same
 *    moment, whatever the player's role.
 *  - "tap": you just confirmed something on your own screen (a vote, your
 *    night choice, Ready). At night everyone has the same screen and the same
 *    confirm button, real or decoy, so it buzzes the same for everyone.
 * Nothing buzzes only for players with a night role.
 */
export type HapticKind = "phase" | "tap";

const PATTERNS: Record<HapticKind, number | number[]> = {
  phase: [40, 60, 40],
  tap: 20,
};

export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function haptic(kind: HapticKind): void {
  if (!getPrefs().haptics || !canVibrate()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Some browsers throw when vibration isn't allowed yet (no tap so far): ignore.
  }
}
