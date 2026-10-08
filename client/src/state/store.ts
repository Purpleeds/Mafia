/**
 * The app's single external store (read with useSyncExternalStore). It only
 * mirrors what the server tells us; game rules live on the server.
 */
import { useSyncExternalStore } from "react";
import type { ChatMessage, GameStatePayload, RemovedReason, SessionInfo } from "@mafia/shared";

export type ConnectionState = "connecting" | "connected" | "reconnecting";

/**
 * idle: no session in use. resuming: sending room:resume (after a refresh or reconnect).
 * active: the server accepted this socket for the session. error: resume failed for a
 * reason that may go away (rate limit, server error).
 */
export type SessionStatus = "idle" | "resuming" | "active" | "error";

export interface ReceivedState {
  payload: GameStatePayload;
  /** performance.now() when it arrived. */
  receivedAt: number;
}

export interface Notice {
  /** Shown on the join screen for this room, or on Home when null. */
  roomCode: string | null;
  message: string;
  reason?: RemovedReason | "expired" | "not_found";
}

export interface Toast {
  id: number;
  text: string;
}

export interface AppState {
  connection: ConnectionState;
  session: SessionInfo | null;
  sessionStatus: SessionStatus;
  sessionError: string | null;
  game: ReceivedState | null;
  chat: ChatMessage[];
  notice: Notice | null;
  /** Set when the same session was opened in another tab or on another device. */
  replaced: string | null;
  toasts: Toast[];
}

let state: AppState = {
  connection: "connecting",
  session: null,
  sessionStatus: "idle",
  sessionError: null,
  game: null,
  chat: [],
  notice: null,
  replaced: null,
  toasts: [],
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Select a slice of the store. Return existing references (not new objects) from the selector. */
export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

// ---------------------------------------------------------------- toasts

let nextToastId = 1;

export function showToast(text: string, durationMs = 4000): void {
  const id = nextToastId++;
  setState({ toasts: [...state.toasts.slice(-2), { id, text }] });
  window.setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: number): void {
  if (!state.toasts.some((t) => t.id === id)) return;
  setState({ toasts: state.toasts.filter((t) => t.id !== id) });
}

export function clearNotice(): void {
  if (state.notice) setState({ notice: null });
}
