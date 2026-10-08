import { useSyncExternalStore } from "react";
import { setMotionOverride } from "../fx/quality";

/**
 * Accessibility choices for this device: reduce motion and text size. Saved in
 * localStorage and applied to <html> (data-motion, data-text), so the CSS and
 * the animated background both follow them.
 */
export type MotionPreference = "auto" | "reduce" | "full";
export type TextSize = "normal" | "large" | "larger";

export interface A11yPreferences {
  motion: MotionPreference;
  textSize: TextSize;
}

export const MOTION_OPTIONS: { value: MotionPreference; label: string }[] = [
  { value: "auto", label: "Same as device" },
  { value: "reduce", label: "On" },
  { value: "full", label: "Off" },
];

export const TEXT_SIZES: { value: TextSize; label: string; scale: number }[] = [
  { value: "normal", label: "Normal", scale: 1 },
  { value: "large", label: "Large", scale: 1.125 },
  { value: "larger", label: "Larger", scale: 1.25 },
];

export const A11Y_STORAGE_KEY = "mafia.a11y";
export const DEFAULT_A11Y: A11yPreferences = { motion: "auto", textSize: "normal" };

export function parseA11y(raw: string | null): A11yPreferences {
  const prefs = { ...DEFAULT_A11Y };
  if (!raw) return prefs;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (MOTION_OPTIONS.some((o) => o.value === v.motion)) prefs.motion = v.motion as MotionPreference;
    if (TEXT_SIZES.some((o) => o.value === v.textSize)) prefs.textSize = v.textSize as TextSize;
  } catch {
    // broken: defaults
  }
  return prefs;
}

/** True/false when the player chose, null to follow the device. */
export function motionOverrideFor(motion: MotionPreference): boolean | null {
  return motion === "reduce" ? true : motion === "full" ? false : null;
}

function read(): string | null {
  try {
    return window.localStorage.getItem(A11Y_STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: A11yPreferences = typeof window === "undefined" ? { ...DEFAULT_A11Y } : parseA11y(read());
const listeners = new Set<() => void>();

function apply(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const deviceReduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const override = motionOverrideFor(current.motion);
  root.dataset.motion = (override ?? deviceReduce) ? "reduce" : "full";
  root.dataset.text = current.textSize;
  setMotionOverride(override);
}

/** Applies the saved choices. Call once at start-up, before the first render. */
export function initA11y(): void {
  apply();
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", apply);
  }
}

export function getA11y(): A11yPreferences {
  return current;
}

export function setA11y(patch: Partial<A11yPreferences>): void {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // storage blocked: lasts for this visit
  }
  apply();
  for (const listener of listeners) listener();
}

export function useA11y(): A11yPreferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getA11y,
    getA11y,
  );
}
