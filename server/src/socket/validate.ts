import {
  SKIP,
  type ChatChannel,
  type ChatSendPayload,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type NightActionPayload,
  type ResumeSessionPayload,
  type TimeSyncPayload,
  type VotePayload,
} from "@mafia/shared";
import { normalizeRoomCode } from "../rooms/ids.js";

/**
 * Shape checks for incoming payloads. They only make sure the data has the
 * right types and sane sizes; game rules (phase, role, target...) are checked
 * by the engine. Each parser builds a fresh object, so unknown fields never
 * travel further.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = <T>(message: string): Parsed<T> => ({ ok: false, message });

const MAX_NAME_INPUT = 64;
const MAX_ID = 64;
const MAX_CHAT_INPUT = 2000;
const MAX_SETTINGS_JSON = 2000;
const CHANNELS: readonly ChatChannel[] = ["public", "mafia", "graveyard"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string, max: number): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length <= max ? v : null;
}

/** For events without data: accepts nothing, null or any object. */
export function parseEmpty(raw: unknown): Parsed<Record<string, never>> {
  if (raw === undefined || raw === null || isRecord(raw)) return ok({});
  return bad("Expected no data.");
}

export function parseCreateRoom(raw: unknown): Parsed<CreateRoomPayload> {
  if (!isRecord(raw)) return bad("Expected { name }.");
  const name = stringField(raw, "name", MAX_NAME_INPUT);
  if (name === null) return bad("name must be a short string.");
  return ok({ name });
}

export function parseJoinRoom(raw: unknown): Parsed<JoinRoomPayload> {
  if (!isRecord(raw)) return bad("Expected { roomCode, name }.");
  const roomCode = normalizeRoomCode(raw.roomCode);
  if (roomCode === null) return bad("Room codes are 4 letters.");
  const name = stringField(raw, "name", MAX_NAME_INPUT);
  if (name === null) return bad("name must be a short string.");
  return ok({ roomCode, name });
}

export function parseResume(raw: unknown): Parsed<ResumeSessionPayload> {
  if (!isRecord(raw)) return bad("Expected { roomCode, sessionToken }.");
  const roomCode = normalizeRoomCode(raw.roomCode);
  if (roomCode === null) return bad("Room codes are 4 letters.");
  const token = raw.sessionToken;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return bad("Invalid session token.");
  return ok({ roomCode, sessionToken: token });
}

/** The engine validates every setting; here we only bound the size. */
export function parseSettingsPatch(raw: unknown): Parsed<Record<string, unknown>> {
  if (!isRecord(raw)) return bad("Expected a settings object.");
  let size: number;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return bad("Settings must be plain data.");
  }
  if (size > MAX_SETTINGS_JSON) return bad("Settings object is too large.");
  return ok(raw);
}

export function parseNightAction(raw: unknown): Parsed<NightActionPayload> {
  if (!isRecord(raw)) return bad("Expected { targetId }.");
  const targetId = stringField(raw, "targetId", MAX_ID);
  if (targetId === null) return bad("targetId must be a player id.");
  if (raw.secondTargetId === undefined) return ok({ targetId });
  const secondTargetId = stringField(raw, "secondTargetId", MAX_ID);
  if (secondTargetId === null) return bad("secondTargetId must be a player id.");
  return ok({ targetId, secondTargetId });
}

export function parseVote(raw: unknown): Parsed<VotePayload> {
  if (!isRecord(raw)) return bad(`Expected { targetId } (a player id or "${SKIP}").`);
  const targetId = stringField(raw, "targetId", MAX_ID);
  if (targetId === null) return bad(`targetId must be a player id or "${SKIP}".`);
  return ok({ targetId });
}

export function parseChat(raw: unknown): Parsed<ChatSendPayload> {
  if (!isRecord(raw)) return bad("Expected { channel, text }.");
  const channel = raw.channel;
  if (typeof channel !== "string" || !(CHANNELS as readonly string[]).includes(channel)) {
    return bad("channel must be public, mafia or graveyard.");
  }
  const text = stringField(raw, "text", MAX_CHAT_INPUT);
  if (text === null) return bad("text must be a string.");
  return ok({ channel: channel as ChatChannel, text });
}

export function parseTimeSync(raw: unknown): Parsed<TimeSyncPayload> {
  if (!isRecord(raw)) return bad("Expected { clientSentAt }.");
  const sent = raw.clientSentAt;
  if (typeof sent !== "number" || !Number.isFinite(sent)) return bad("clientSentAt must be a number.");
  return ok({ clientSentAt: sent });
}
