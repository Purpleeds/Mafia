import {
  ROOM_PASSWORD_MAX_LENGTH,
  SKIP,
  isAvatar,
  normalizeRoomCode,
  type Avatar,
  CHAT_REACTIONS,
  type ChatReactPayload,
  type DevFillBotsPayload,
  type ChatReaction,
  type ChatSendPayload,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type NarratorSubmitPayload,
  type NightActionPayload,
  type PeekRoomPayload,
  type ResumeSessionPayload,
  type SetPasswordPayload,
  type TargetPlayerPayload,
  type TimeSyncPayload,
  type UpdateProfilePayload,
  type VotePayload,
} from "@mafia/shared";

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
const MAX_CODE_INPUT = 16;
const MAX_PASSWORD_INPUT = ROOM_PASSWORD_MAX_LENGTH * 4;
const MAX_ID = 64;
const MAX_CHAT_INPUT = 2000;
const MAX_NARRATION_INPUT = 4000;
const MAX_SETTINGS_JSON = 2000;

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

/** Avatars are copied field by field so nothing else rides along. */
function avatarField(obj: Record<string, unknown>): Avatar | null {
  const value = obj.avatar;
  return isAvatar(value) ? { color: value.color, seed: value.seed } : null;
}

/** Optional string: undefined if absent, null if present but invalid. */
function optionalString(obj: Record<string, unknown>, key: string, max: number): string | undefined | null {
  if (obj[key] === undefined) return undefined;
  return stringField(obj, key, max);
}

function roomCodeField(obj: Record<string, unknown>): string | null {
  const raw = obj.roomCode;
  if (typeof raw !== "string" || raw.length > MAX_CODE_INPUT) return null;
  return normalizeRoomCode(raw);
}

export function parseCreateRoom(raw: unknown): Parsed<CreateRoomPayload> {
  if (!isRecord(raw)) return bad("Expected { name, avatar }.");
  const name = stringField(raw, "name", MAX_NAME_INPUT);
  if (name === null) return bad("name must be a short string.");
  const avatar = avatarField(raw);
  if (!avatar) return bad("Pick an avatar colour and look.");
  const customCode = optionalString(raw, "customCode", MAX_CODE_INPUT);
  if (customCode === null) return bad("customCode must be 4–8 letters or numbers.");
  const password = optionalString(raw, "password", MAX_PASSWORD_INPUT);
  if (password === null) return bad("password must be a string.");
  const value: CreateRoomPayload = { name, avatar };
  if (customCode !== undefined) value.customCode = customCode;
  if (password !== undefined) value.password = password;
  return ok(value);
}

export function parsePeekRoom(raw: unknown): Parsed<PeekRoomPayload> {
  if (!isRecord(raw)) return bad("Expected { roomCode }.");
  const roomCode = roomCodeField(raw);
  if (roomCode === null) return bad("Room codes are 4–8 letters or numbers.");
  return ok({ roomCode });
}

export function parseJoinRoom(raw: unknown): Parsed<JoinRoomPayload> {
  if (!isRecord(raw)) return bad("Expected { roomCode, name, avatar }.");
  const roomCode = roomCodeField(raw);
  if (roomCode === null) return bad("Room codes are 4–8 letters or numbers.");
  const name = stringField(raw, "name", MAX_NAME_INPUT);
  if (name === null) return bad("name must be a short string.");
  const avatar = avatarField(raw);
  if (!avatar) return bad("Pick an avatar colour and look.");
  const password = optionalString(raw, "password", MAX_PASSWORD_INPUT);
  if (password === null) return bad("password must be a string.");
  const value: JoinRoomPayload = { roomCode, name, avatar };
  if (password !== undefined) value.password = password;
  return ok(value);
}

export function parseResume(raw: unknown): Parsed<ResumeSessionPayload> {
  if (!isRecord(raw)) return bad("Expected { roomCode, sessionToken }.");
  const roomCode = roomCodeField(raw);
  if (roomCode === null) return bad("Room codes are 4–8 letters or numbers.");
  const token = raw.sessionToken;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return bad("Invalid session token.");
  return ok({ roomCode, sessionToken: token });
}

export function parseUpdateProfile(raw: unknown): Parsed<UpdateProfilePayload> {
  if (!isRecord(raw)) return bad("Expected { name?, avatar? }.");
  const value: UpdateProfilePayload = {};
  if (raw.name !== undefined) {
    const name = stringField(raw, "name", MAX_NAME_INPUT);
    if (name === null) return bad("name must be a short string.");
    value.name = name;
  }
  if (raw.avatar !== undefined) {
    const avatar = avatarField(raw);
    if (!avatar) return bad("Pick an avatar colour and look.");
    value.avatar = avatar;
  }
  if (value.name === undefined && value.avatar === undefined) return bad("Nothing to change.");
  return ok(value);
}

export function parseTargetPlayer(raw: unknown): Parsed<TargetPlayerPayload> {
  if (!isRecord(raw)) return bad("Expected { playerId }.");
  const playerId = stringField(raw, "playerId", MAX_ID);
  if (playerId === null) return bad("playerId must be a player id.");
  return ok({ playerId });
}

export function parseSetPassword(raw: unknown): Parsed<SetPasswordPayload> {
  if (!isRecord(raw)) return bad("Expected { password }.");
  if (raw.password === null) return ok({ password: null });
  const password = stringField(raw, "password", MAX_PASSWORD_INPUT);
  if (password === null) return bad("password must be a string or null.");
  return ok({ password });
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

/** The AI's text is only bounded here; checkNarration (in the engine) decides if it is fit to show. */
export function parseNarratorSubmit(raw: unknown): Parsed<NarratorSubmitPayload> {
  if (!isRecord(raw)) return bad("Expected { requestId, text }.");
  const requestId = raw.requestId;
  if (typeof requestId !== "string" || !/^[a-z0-9]{3,64}$/.test(requestId)) return bad("Invalid requestId.");
  if (raw.text === null) return ok({ requestId, text: null });
  const text = stringField(raw, "text", MAX_NARRATION_INPUT);
  if (text === null) return bad("text must be a string or null.");
  return ok({ requestId, text });
}

export function parseChat(raw: unknown): Parsed<ChatSendPayload> {
  if (!isRecord(raw)) return bad("Expected { text }.");
  // Any "channel" a client sends is ignored: the server decides where a message goes.
  const text = stringField(raw, "text", MAX_CHAT_INPUT);
  if (text === null) return bad("text must be a string.");
  return ok({ text });
}

export function parseFillBots(raw: unknown): Parsed<DevFillBotsPayload> {
  if (raw === undefined || raw === null) return ok({});
  if (!isRecord(raw)) return bad("Expected { count? }.");
  const count = raw.count;
  if (count === undefined) return ok({});
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 20) {
    return bad("count must be a whole number from 1 to 20.");
  }
  return ok({ count });
}

export function parseReaction(raw: unknown): Parsed<ChatReactPayload> {
  if (!isRecord(raw)) return bad("Expected { reaction }.");
  const reaction = raw.reaction;
  if (typeof reaction !== "string" || !(CHAT_REACTIONS as readonly string[]).includes(reaction)) {
    return bad("reaction must be one of: " + CHAT_REACTIONS.join(", ") + ".");
  }
  return ok({ reaction: reaction as ChatReaction });
}

export function parseTimeSync(raw: unknown): Parsed<TimeSyncPayload> {
  if (!isRecord(raw)) return bad("Expected { clientSentAt }.");
  const sent = raw.clientSentAt;
  if (typeof sent !== "number" || !Number.isFinite(sent)) return bad("clientSentAt must be a number.");
  return ok({ clientSentAt: sent });
}
