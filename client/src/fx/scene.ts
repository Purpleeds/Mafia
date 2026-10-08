import { useSyncExternalStore } from "react";
import type { ContentMode } from "@mafia/shared";
import type { SceneTarget } from "./timeOfDay";

/** What the background should show, set by the app, read by the backdrop (WebGL or static). */
let scene: SceneTarget = { mode: "safe", phase: null, winner: null };
const sceneListeners = new Set<() => void>();

export function getScene(): SceneTarget {
  return scene;
}

export function setScene(next: SceneTarget): void {
  if (next.mode === scene.mode && next.phase === scene.phase && next.winner === scene.winner) return;
  // A new game (or the lobby between games) starts with a clean slate of one-off effects.
  if (next.phase !== scene.phase && (next.phase === "LOBBY" || next.phase === "ROLE_REVEAL")) resetMoments();
  scene = next;
  for (const listener of sceneListeners) listener();
}

export function subscribeScene(listener: () => void): () => void {
  sceneListeners.add(listener);
  return () => sceneListeners.delete(listener);
}

export function useScene(): SceneTarget {
  return useSyncExternalStore(subscribeScene, getScene, getScene);
}

/** One-off effects: an elimination (mode-dependent) or a Doctor's save. */
export type FxEvent = { kind: "eliminate"; mode: ContentMode } | { kind: "save" };

const fxListeners = new Set<(event: FxEvent) => void>();

export function emitFx(event: FxEvent): void {
  for (const listener of fxListeners) listener(event);
}

export function subscribeFx(listener: (event: FxEvent) => void): () => void {
  fxListeners.add(listener);
  return () => fxListeners.delete(listener);
}

const moments = new Map<string, number>();
const emitted = new Set<string>();

/** Forgets which one-off effects have played (a new game begins). */
export function resetMoments(): void {
  moments.clear();
  emitted.clear();
}

/**
 * True the first time a moment (e.g. "night:3") is shown in this page, so its
 * effect plays once rather than on every re-render or re-mount. A repeat within
 * a second still counts as the first (React's development double-render).
 */
export function claimMoment(key: string): boolean {
  const now = Date.now();
  const first = moments.get(key);
  if (first === undefined) {
    moments.set(key, now);
    return true;
  }
  return now - first < 1000;
}

/** Emits an effect once per key. */
export function emitFxOnce(key: string, event: FxEvent): void {
  if (emitted.has(key)) return;
  emitted.add(key);
  emitFx(event);
}
