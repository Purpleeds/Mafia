import { useSyncExternalStore } from "react";
import {
  AVATAR_ROOM_HEADER,
  AVATAR_UPLOAD_PATH,
  type AckResult,
  type GameView,
  type SessionInfo,
} from "@mafia/shared";
import { friendlyError } from "./errors";
import { showToast } from "../state/store";

/**
 * The player's own picture, already cropped and shrunk to 128x128 on this
 * device, so it can go up again in the next room without picking it again.
 * `use` is whether to use it (or the drawn avatar) when joining a room.
 */
export interface SavedPhoto {
  dataUrl: string;
  use: boolean;
}

const PHOTO_KEY = "mafia.photo";
/** Seats (room:player) where the host turned the picture down or removed it: it isn't sent again there. */
const DECLINED_KEY = "mafia.photoDeclined";
const MAX_DATA_URL = 400_000;

export function isSavedPhotoUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length < MAX_DATA_URL &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
  );
}

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function parseSavedPhoto(value: unknown): SavedPhoto | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  return isSavedPhotoUrl(v.dataUrl) ? { dataUrl: v.dataUrl, use: v.use !== false } : null;
}

let current: SavedPhoto | null = typeof window === "undefined" ? null : parseSavedPhoto(read(PHOTO_KEY));
const listeners = new Set<() => void>();

export function loadPhoto(): SavedPhoto | null {
  return current;
}

/** Saves (or with null, forgets) the picture on this device. False if the browser wouldn't store it. */
export function savePhoto(photo: SavedPhoto | null): boolean {
  current = photo;
  const stored = write(PHOTO_KEY, photo);
  for (const listener of listeners) listener();
  return stored;
}

export function useSavedPhoto(): SavedPhoto | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadPhoto,
    loadPhoto,
  );
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head = "", body = ""] = dataUrl.split(",");
  const mime = /^data:([^;]+);base64$/.exec(head)?.[1] ?? "application/octet-stream";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export type UploadResult = { ok: true; status: "pending" | "approved" } | { ok: false; message: string };

/** Sends the picture to the server, which checks and re-encodes it before anyone sees it. */
export async function uploadPhoto(session: SessionInfo, dataUrl: string): Promise<UploadResult> {
  try {
    const response = await fetch(AVATAR_UPLOAD_PATH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.sessionToken}`,
        [AVATAR_ROOM_HEADER]: session.roomCode,
        "Content-Type": "application/octet-stream",
      },
      body: dataUrlToBlob(dataUrl),
    });
    const result = (await response.json().catch(() => null)) as AckResult<{ status: "pending" | "approved" }> | null;
    if (!result) return { ok: false, message: "The server didn't answer properly. Try again." };
    if (result.ok) {
      allowAgain(session);
      return { ok: true, status: result.data.status };
    }
    return { ok: false, message: friendlyError(result.error) };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
}

const seatKey = (session: Pick<SessionInfo, "roomCode" | "playerId">) => `${session.roomCode}:${session.playerId}`;

function declinedSeats(): string[] {
  const value = read(DECLINED_KEY);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(-20) : [];
}

/** The host turned your picture down or removed it: don't send it again by yourself in this seat. */
export function markDeclined(session: Pick<SessionInfo, "roomCode" | "playerId">): void {
  write(DECLINED_KEY, [...declinedSeats().filter((k) => k !== seatKey(session)), seatKey(session)]);
}

function allowAgain(session: Pick<SessionInfo, "roomCode" | "playerId">): void {
  const seats = declinedSeats();
  if (seats.includes(seatKey(session))) write(DECLINED_KEY, seats.filter((k) => k !== seatKey(session)));
}

let triedFor: string | null = null;

/** A new room or a fresh page: the saved picture may be sent once more. */
export function resetPhotoUpload(): void {
  triedFor = null;
}

/**
 * Once you're in a lobby that allows pictures, sends the picture saved on this
 * device (if you chose to use it). Only once per seat, and never again where
 * the host turned it down or removed it.
 */
export async function maybeUploadSavedPhoto(session: SessionInfo | null, view: GameView): Promise<void> {
  if (!session || view.phase !== "LOBBY" || !view.you || view.settings.customAvatars === "off") return;
  const key = seatKey(session);
  if (triedFor === key) return;
  triedFor = key;
  const saved = loadPhoto();
  if (!saved?.use || view.you.photo || declinedSeats().includes(key)) return;
  const result = await uploadPhoto(session, saved.dataUrl);
  if (!result.ok) showToast(`Your picture couldn't be used: ${result.message}`, 6000);
  else if (result.status === "pending") showToast("Your picture is waiting for the host to approve it.");
}
