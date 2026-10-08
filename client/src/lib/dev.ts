import { useSyncExternalStore } from "react";
import { setPerTabStorage } from "./storage";

/**
 * Development tools (bots, the debug panel, one identity per browser tab).
 * The server decides: it answers /dev-config with { dev: true } only when it
 * runs outside production, so a production site never shows any of this.
 */
let dev = false;
const listeners = new Set<() => void>();

export function isDevMode(): boolean {
  return dev;
}

export function useDevMode(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isDevMode,
    isDevMode,
  );
}

/** Asks the server once, before the app starts. Any failure means "not dev". */
export async function loadDevConfig(timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch("/dev-config", { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    const on = typeof body === "object" && body !== null && (body as { dev?: unknown }).dev === true;
    setDevMode(on);
    return on;
  } catch {
    return false;
  }
}

export function setDevMode(on: boolean): void {
  if (dev === on) return;
  dev = on;
  // Each tab is its own player, so several tabs of one browser can play together.
  setPerTabStorage(on);
  for (const listener of listeners) listener();
}
