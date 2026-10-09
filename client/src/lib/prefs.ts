import { useSyncExternalStore } from "react";
import { filterChatText } from "@mafia/shared";

/**
 * Personal choices that only affect this device's screen: they're saved in
 * localStorage and never sent to the server.
 */
export interface PersonalPrefs {
  /** Hide strong language in chat on this screen, whatever the host chose. */
  hideStrongLanguage: boolean;
  /** Short vibrations on phones that support them (the same for every player). */
  haptics: boolean;
  /** One-time tips explaining each phase. */
  hints: boolean;
  /** Keep the screen on during a game. */
  keepAwake: boolean;
}

export const PREFS_STORAGE_KEY = "mafia.prefs";
export const DEFAULT_PREFS: PersonalPrefs = { hideStrongLanguage: false, haptics: true, hints: true, keepAwake: true };

export function parsePrefs(raw: string | null): PersonalPrefs {
  const prefs = { ...DEFAULT_PREFS };
  if (!raw) return prefs;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_PREFS) as (keyof PersonalPrefs)[]) {
      if (typeof v[key] === "boolean") prefs[key] = v[key] as boolean;
    }
  } catch {
    // broken: defaults
  }
  return prefs;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: lasts for this visit
  }
}

let current: PersonalPrefs = typeof window === "undefined" ? { ...DEFAULT_PREFS } : parsePrefs(readStorage(PREFS_STORAGE_KEY));
const listeners = new Set<() => void>();

export function getPrefs(): PersonalPrefs {
  return current;
}

export function setPrefs(patch: Partial<PersonalPrefs>): void {
  current = { ...current, ...patch };
  writeStorage(PREFS_STORAGE_KEY, JSON.stringify(current));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): PersonalPrefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}

/** What a chat message says on this screen: as sent, or with strong language hidden if this player asked for that. */
export function displayChatText(text: string, prefs: Pick<PersonalPrefs, "hideStrongLanguage">): string {
  return prefs.hideStrongLanguage ? filterChatText(text, "strict") : text;
}

// ---------------------------------------------------------------- muted players

/**
 * Players whose chat you've muted, per room (ids only mean something inside
 * their room). Only the few most recent rooms are kept.
 */
export const MUTED_STORAGE_KEY = "mafia.muted";
const MAX_ROOMS = 5;

type MutedMap = Record<string, string[]>;

function readMuted(): MutedMap {
  try {
    const value = JSON.parse(readStorage(MUTED_STORAGE_KEY) ?? "{}") as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const out: MutedMap = {};
    for (const [room, ids] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(ids)) out[room] = ids.filter((id): id is string => typeof id === "string").slice(0, 40);
    }
    return out;
  } catch {
    return {};
  }
}

let muted: MutedMap = typeof window === "undefined" ? {} : readMuted();
const NONE: readonly string[] = [];
const mutedListeners = new Set<() => void>();

export function mutedIn(roomCode: string): readonly string[] {
  return muted[roomCode] ?? NONE;
}

export function setMuted(roomCode: string, playerId: string, mute: boolean): void {
  const others = (muted[roomCode] ?? []).filter((id) => id !== playerId);
  const next = mute ? [...others, playerId] : others;
  const rest = Object.entries(muted).filter(([room]) => room !== roomCode).slice(-(MAX_ROOMS - 1));
  muted = Object.fromEntries([...rest, [roomCode, next]]);
  writeStorage(MUTED_STORAGE_KEY, JSON.stringify(muted));
  for (const listener of mutedListeners) listener();
}

export function useMuted(roomCode: string): readonly string[] {
  return useSyncExternalStore(
    (listener) => {
      mutedListeners.add(listener);
      return () => mutedListeners.delete(listener);
    },
    () => mutedIn(roomCode),
    () => mutedIn(roomCode),
  );
}
