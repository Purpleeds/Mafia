/**
 * Small, failure-tolerant wrappers around localStorage. Private browsing or a
 * full quota must never break joining a game, so every access is guarded.
 */
import { normalizeRoomCode, type Avatar, type SessionInfo } from "@mafia/shared";
import { migrateAvatar } from "./avatars";

const SESSION_PREFIX = "mafia:session:";
const ACTIVE_KEY = "mafia:active";
const PROFILE_KEY = "mafia:profile";

/**
 * Normally your seat is remembered per browser (localStorage), so closing the tab
 * and coming back resumes it. In development it is remembered per tab
 * (sessionStorage) instead, so several tabs of one browser can be different players.
 */
let perTab = false;

export function setPerTabStorage(on: boolean): void {
  perTab = on;
}

function area(): Storage {
  return perTab ? window.sessionStorage : window.localStorage;
}

function read(key: string): unknown {
  try {
    const raw = area().getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    area().setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the game still works, it just won't survive a refresh.
  }
}

function remove(key: string): void {
  try {
    area().removeItem(key);
  } catch {
    // ignore
  }
}

function isSessionInfo(value: unknown): value is SessionInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.roomCode === "string" &&
    typeof v.playerId === "string" &&
    typeof v.sessionToken === "string" &&
    (v.seat === "player" || v.seat === "spectator")
  );
}

// ---------------------------------------------------------------- sessions

export function loadSession(roomCode: string): SessionInfo | null {
  const value = read(SESSION_PREFIX + roomCode);
  return isSessionInfo(value) && value.roomCode === roomCode ? value : null;
}

export function saveSession(info: SessionInfo): void {
  write(SESSION_PREFIX + info.roomCode, info);
  write(ACTIVE_KEY, info.roomCode);
}

export function forgetSession(roomCode: string): void {
  remove(SESSION_PREFIX + roomCode);
  if (normalizeRoomCode(read(ACTIVE_KEY)) === roomCode) remove(ACTIVE_KEY);
}

/** The room you were last in, if its session is still saved. */
export function loadActiveRoom(): string | null {
  const code = normalizeRoomCode(read(ACTIVE_KEY));
  return code !== null && loadSession(code) !== null ? code : null;
}

// ---------------------------------------------------------------- profile

export interface SavedProfile {
  name: string;
  avatar: Avatar;
}

export function loadProfile(): Partial<SavedProfile> {
  const value = read(PROFILE_KEY);
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  const profile: Partial<SavedProfile> = {};
  if (typeof v.name === "string") profile.name = v.name;
  const avatar = migrateAvatar(v.avatar);
  if (avatar) profile.avatar = avatar;
  return profile;
}

export function saveProfile(profile: Partial<SavedProfile>): void {
  write(PROFILE_KEY, { ...loadProfile(), ...profile });
}
