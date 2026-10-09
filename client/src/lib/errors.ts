import type { ErrorCode } from "@mafia/shared";

/** Errors the client produces itself (no answer from the server). */
export type ClientErrorCode = "TIMEOUT" | "OFFLINE";

export interface CallError {
  code: ErrorCode | ClientErrorCode;
  message: string;
}

const FRIENDLY: Partial<Record<ErrorCode | ClientErrorCode, string>> = {
  TIMEOUT: "The server didn't answer. Check your connection and try again.",
  OFFLINE: "You're offline. Reconnecting…",
  RATE_LIMITED: "Too many tries. Wait a moment and try again.",
  SERVER_BUSY: "The server is busy right now. Try again in a minute.",
  SERVER_ERROR: "Something went wrong on the server. Try again.",
  ROOM_NOT_FOUND: "That room doesn't exist (or has closed).",
  ROOM_FULL: "That room is full.",
  NAME_TAKEN: "Someone in the room already has that nickname.",
  INVALID_NAME: "That nickname can't be used. Try another.",
  CODE_TAKEN: "That code is taken. Try another.",
  CODE_INVALID: "That code can't be used. Use 4–8 letters or numbers.",
  PASSWORD_REQUIRED: "This room needs a password.",
  WRONG_PASSWORD: "That password isn't right.",
  NOT_HOST: "Only the host can do that.",
  NOT_ENOUGH_PLAYERS: "Not enough players to start.",
  TOO_MANY_ROLES: "Too many special roles for this many players.",
  INVALID_SETTINGS: "Those settings aren't allowed.",
  WRONG_PHASE: "That can't be done right now.",
  NOT_IN_ROOM: "You're not in this room any more.",
  SESSION_INVALID: "Your seat in this room has expired.",
  BAD_REQUEST: "Something about that didn't work. Try again.",
  CHAT_LINK: "Links can't be shared in chat.",
  CHAT_NOT_ALLOWED: "You can't send messages right now.",
  AVATAR_INVALID: "That picture can't be used. Pick a PNG, JPG or WebP picture.",
  AVATAR_TOO_LARGE: "Pictures can be at most 2 MB.",
  AVATARS_OFF: "The host has turned off custom pictures in this room.",
  TIME_LIMIT: "That's as much time as a phase can have.",
  INVALID_TARGET: "You can't pick that player.",
  DEAD_PLAYER: "You're out of this game, so you can't do that.",
  SPECTATOR: "You're watching this game. You'll play in the next one.",
  NOT_IN_GAME: "You're not in this game.",
  INVALID_AVATAR: "Pick an avatar colour and look.",
  ALREADY_JOINED: "You're already in this room.",
  REPEAT_PROTECTION: "You can't protect the same player two nights in a row.",
  NO_ABILITY: "You don't have a night action.",
};

/**
 * Codes where the server's own words are better than ours: they say exactly
 * what to change (a nickname rule, a password length, a picture problem).
 */
const SERVER_WORDS = new Set<string>(["INVALID_NAME", "AVATAR_INVALID", "BAD_REQUEST", "INVALID_SETTINGS", "TIME_LIMIT"]);

/** Server messages that read like they were meant for developers, never shown as they are. */
const TECHNICAL = /\b(?:payload|expected|object|must be a|string|boolean|undefined|null|json|id)\b|[{}\[\]]/i;

/**
 * A message for people. Our wording for known codes; the server's own words
 * when they say exactly what to fix (and aren't technical); otherwise a plain
 * "Something went wrong".
 */
export function friendlyError(error: CallError): string {
  const message = error.message?.trim() ?? "";
  if (SERVER_WORDS.has(error.code) && message && !TECHNICAL.test(message)) return message;
  return FRIENDLY[error.code] ?? (message && !TECHNICAL.test(message) ? message : "Something went wrong. Try again.");
}
