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
};

/** A message for people, preferring our wording over the server's for known codes. */
export function friendlyError(error: CallError): string {
  return FRIENDLY[error.code] ?? (error.message || "Something went wrong. Try again.");
}
