import { containsProfanity } from "./profanity.js";

// ---------------------------------------------------------------- nicknames

export const NICKNAME_MAX_LENGTH = 16;

/** Letters (any language), numbers, spaces and basic punctuation. */
const NICKNAME_CHARS = /^[\p{L}\p{M}\p{N} .,'!?&()_-]+$/u;

export type CheckResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Cleans and checks a nickname. Used by the client for instant feedback and by
 * the server, which has the final say (it also checks names are unique).
 */
export function validateNickname(raw: unknown): CheckResult<string> {
  if (typeof raw !== "string") return { ok: false, reason: "Enter a nickname." };
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length === 0) return { ok: false, reason: "Enter a nickname." };
  if ([...name].length > NICKNAME_MAX_LENGTH) {
    return { ok: false, reason: `Nicknames can be at most ${NICKNAME_MAX_LENGTH} characters.` };
  }
  // Invisible characters (U+FE0F, U+3164 ...) would let two names look identical.
  if (!NICKNAME_CHARS.test(name) || /\p{M}{3,}/u.test(name) || /\p{Default_Ignorable_Code_Point}/u.test(name)) {
    return { ok: false, reason: "Use only letters, numbers, spaces and . , ' ! ? & ( ) - _" };
  }
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, reason: "Include at least one letter or number." };
  if (containsProfanity(name)) return { ok: false, reason: "Please pick a different nickname." };
  return { ok: true, value: name };
}

/** Two nicknames clash if they match after compatibility normalisation, ignoring case. */
export function nicknameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase();
}

// ---------------------------------------------------------------- avatars

export const AVATAR_COLORS = [
  "red", "orange", "amber", "lime", "green", "teal", "cyan", "blue", "indigo", "violet", "pink", "slate",
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Up to 16 lowercase letters/digits. The client draws a character (hat, face, hair...) from it. */
export const AVATAR_SEED_MAX_LENGTH = 16;
const AVATAR_SEED = /^[a-z0-9]{1,16}$/;

export function isAvatarSeed(value: unknown): value is string {
  return typeof value === "string" && AVATAR_SEED.test(value);
}

/**
 * A player's look: a colour they pick, plus a seed that procedurally decides
 * their character's hat, face and hair. The same seed always draws the same
 * character, so players keep their look.
 */
export interface Avatar {
  color: AvatarColor;
  seed: string;
}

/**
 * An avatar as the server shows it: the generated look, plus `photo` (the id
 * of a picture sent with avatar:images) when the player's own picture is
 * showing. The generated look stays underneath as the fallback.
 */
export interface AvatarView extends Avatar {
  photo?: string;
}

export function isAvatar(value: unknown): value is Avatar {
  if (typeof value !== "object" || value === null) return false;
  const { color, seed } = value as Record<string, unknown>;
  return typeof color === "string" && (AVATAR_COLORS as readonly string[]).includes(color) && isAvatarSeed(seed);
}

// ---------------------------------------------------------------- room codes

export const ROOM_CODE_LENGTH = 4;
/** Generated codes: uppercase letters without the look-alikes O, I and L (and no digits, so no 0 or 1). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const CUSTOM_CODE_MIN_LENGTH = 4;
export const CUSTOM_CODE_MAX_LENGTH = 8;

/** Codes that would clash with server routes (Express paths are case-insensitive). */
const RESERVED_CODES = new Set(["HEALTHZ", "ASSETS", "API", "ADMIN", "STATIC", "SOCKETIO", "INDEX", "FAVICON"]);

/**
 * Turns what someone typed or scanned into a room code: case-insensitive,
 * ignores spaces and dashes. Null if it can't be any room's code.
 */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  const pattern = new RegExp(`^[A-Z0-9]{${CUSTOM_CODE_MIN_LENGTH},${CUSTOM_CODE_MAX_LENGTH}}$`);
  return pattern.test(code) ? code : null;
}

/** Checks a host's custom code (4–8 letters or numbers, nothing rude, not reserved). Availability is checked by the server. */
export function validateCustomRoomCode(raw: unknown): CheckResult<string> {
  const code = normalizeRoomCode(raw);
  if (code === null) {
    return {
      ok: false,
      reason: `Room codes are ${CUSTOM_CODE_MIN_LENGTH}–${CUSTOM_CODE_MAX_LENGTH} letters or numbers.`,
    };
  }
  if (RESERVED_CODES.has(code)) return { ok: false, reason: "That code is reserved. Try another." };
  if (containsProfanity(code)) return { ok: false, reason: "Please pick a different code." };
  return { ok: true, value: code };
}

/** "/ABCD" (or "/abcd/") -> "ABCD"; null for any other path. */
export function roomCodeFromPath(pathname: string): string | null {
  const match = /^\/([A-Za-z0-9]{4,8})\/?$/.exec(pathname);
  return match ? normalizeRoomCode(match[1]) : null;
}

export function joinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/${code}`;
}

// ---------------------------------------------------------------- passwords

export const ROOM_PASSWORD_MIN_LENGTH = 3;
export const ROOM_PASSWORD_MAX_LENGTH = 32;

export function validateRoomPassword(raw: unknown): CheckResult<string> {
  if (typeof raw !== "string") return { ok: false, reason: "Enter a password." };
  const length = [...raw].length;
  if (length < ROOM_PASSWORD_MIN_LENGTH || length > ROOM_PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      reason: `Passwords are ${ROOM_PASSWORD_MIN_LENGTH}–${ROOM_PASSWORD_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true, value: raw };
}

// ---------------------------------------------------------------- avatar pictures

/** The biggest picture a player may upload. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** Pictures are cropped square and stored at this size (pixels). */
export const AVATAR_SIZE = 128;
/** What the file picker offers. GIFs (animation) and SVGs (scripts) are never accepted. */
export const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";
/** Where the client sends a picture (POST, raw bytes, with the room code and session token in headers). */
export const AVATAR_UPLOAD_PATH = "/api/avatar";
export const AVATAR_ROOM_HEADER = "x-room-code";

export type ImageKind = "png" | "jpeg" | "webp" | "gif" | "svg" | "other";

/**
 * What a file really is, from its first bytes (never its name or the type the
 * browser claims): PNG, JPEG and WebP are allowed; GIF and SVG are recognised
 * so they can be refused with a clear message.
 */
export function sniffImageType(bytes: Uint8Array): ImageKind {
  const at = (i: number) => bytes[i] ?? -1;
  const ascii = (from: number, length: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(from, from + length)));
  if (at(0) === 0x89 && ascii(1, 3) === "PNG" && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
    return "png";
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  // SVG is text: skip a byte-order mark and whitespace, then look for an XML or <svg start.
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 512))
    .replace(/^\ufeff/, "")
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype svg") || /<svg[\s>]/.test(head)) {
    return "svg";
  }
  return "other";
}

/** Why a picture can't be used, in words for the player; null if its type and size are fine. */
export function avatarFileProblem(kind: ImageKind, size: number): string | null {
  if (size === 0) return "That file is empty.";
  if (kind === "gif") return "GIFs can't be used. Pick a PNG, JPG or WebP picture.";
  if (kind === "svg") return "SVG files can't be used. Pick a PNG, JPG or WebP picture.";
  if (kind === "other") return "That file isn't a PNG, JPG or WebP picture.";
  if (size > AVATAR_MAX_BYTES) return "Pictures can be at most 2 MB.";
  return null;
}
