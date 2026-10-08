import { createHash, randomBytes, randomInt } from "node:crypto";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@mafia/shared";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** Accepts any case and surrounding spaces; returns null if it can't be a room code. */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** Public player id (appears in every view). Starts with a letter, as the engine requires. */
export function newPlayerId(): string {
  return `p${randomBytes(9).toString("base64url")}`;
}

/** Secret that lets a player rejoin after a refresh. 192 bits. */
export function newSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
