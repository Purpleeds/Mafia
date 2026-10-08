import { createHash, randomBytes, randomInt } from "node:crypto";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@mafia/shared";

/** A random 4-letter code from the look-alike-free alphabet (the caller filters rude words and collisions). */
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** Public member id (appears in every view). Starts with a letter, as the engine requires. */
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

/** Short fingerprint of what was last sent to a player. */
export function digest(text: string): string {
  return createHash("sha1").update(text).digest("base64url");
}
