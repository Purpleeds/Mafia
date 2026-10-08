/**
 * The complete Socket.IO contract between the server and the client.
 *
 * Every client -> server event has the same shape: `(payload, ack)`. The server
 * always answers through `ack` with an AckResult; events sent without an ack get
 * their error (if any) as a `server:error` event instead.
 *
 * The server never accepts a player id from the client: who you are comes from
 * the session the socket joined with.
 */
import type { ChatChannel, GameErrorCode, GameView, SettingsPatch } from "./game.js";

// ---------------------------------------------------------------- limits

export const ROOM_CODE_LENGTH = 4;
/** No I or O, so codes can't be confused with 1 and 0. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const MAX_CHAT_LENGTH = 300;

// ---------------------------------------------------------------- errors & acks

export type TransportErrorCode =
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "ROOM_NOT_FOUND"
  | "NOT_IN_ROOM"
  | "SESSION_INVALID"
  | "CHAT_NOT_ALLOWED"
  | "SERVER_BUSY"
  | "SERVER_ERROR";

export type ErrorCode = GameErrorCode | TransportErrorCode;

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

export type AckResult<T = null> = { ok: true; data: T } | { ok: false; error: ErrorPayload };
export type Ack<T = null> = (result: AckResult<T>) => void;

// ---------------------------------------------------------------- client -> server payloads

export type EmptyPayload = Record<string, never>;

export interface CreateRoomPayload {
  name: string;
}

export interface JoinRoomPayload {
  roomCode: string;
  name: string;
}

export interface ResumeSessionPayload {
  roomCode: string;
  sessionToken: string;
}

/** Returned when you create, join or resume. Keep `sessionToken` secret (e.g. localStorage) to rejoin after a refresh. */
export interface SessionInfo {
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

export interface NightActionPayload {
  targetId: string;
  /** Cupid only: the second player to link. */
  secondTargetId?: string;
}

export interface VotePayload {
  /** A player id, or SKIP. */
  targetId: string;
}

export interface ChatSendPayload {
  channel: ChatChannel;
  text: string;
}

export interface TimeSyncPayload {
  /** The client's Date.now() when it sent the request (echoed back). */
  clientSentAt: number;
}

export interface TimeSyncResult {
  clientSentAt: number;
  serverNow: number;
}

// ---------------------------------------------------------------- server -> client payloads

export interface ServerHelloPayload {
  serverNow: number;
}

/**
 * Your personalised view of the game. `serverNow` is the server clock when this
 * was sent, so a countdown is `view.phaseEndsAt - serverNow` minus the time
 * elapsed locally since it arrived; the client clock is never trusted.
 * `version` only increases: ignore a payload older than the one you have.
 */
export interface GameStatePayload {
  version: number;
  serverNow: number;
  view: GameView;
}

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: number;
}

export interface ChatHistoryPayload {
  messages: ChatMessage[];
}

export type RemovedReason = "left" | "dropped" | "room_closed";

export interface RemovedPayload {
  reason: RemovedReason;
  message: string;
}

export interface SessionReplacedPayload {
  message: string;
}

// ---------------------------------------------------------------- event maps

export interface ClientToServerEvents {
  "room:create": (payload: CreateRoomPayload, ack: Ack<SessionInfo>) => void;
  "room:join": (payload: JoinRoomPayload, ack: Ack<SessionInfo>) => void;
  "room:resume": (payload: ResumeSessionPayload, ack: Ack<SessionInfo>) => void;
  "room:leave": (payload: EmptyPayload, ack: Ack) => void;
  "lobby:updateSettings": (payload: SettingsPatch, ack: Ack) => void;
  "game:start": (payload: EmptyPayload, ack: Ack) => void;
  "game:ackRole": (payload: EmptyPayload, ack: Ack) => void;
  "game:nightAction": (payload: NightActionPayload, ack: Ack) => void;
  "game:vote": (payload: VotePayload, ack: Ack) => void;
  "game:restart": (payload: EmptyPayload, ack: Ack) => void;
  "chat:send": (payload: ChatSendPayload, ack: Ack) => void;
  "time:sync": (payload: TimeSyncPayload, ack: Ack<TimeSyncResult>) => void;
}

export interface ServerToClientEvents {
  "server:hello": (payload: ServerHelloPayload) => void;
  "game:state": (payload: GameStatePayload) => void;
  "chat:message": (payload: ChatMessage) => void;
  "chat:history": (payload: ChatHistoryPayload) => void;
  /** You are no longer in the room (left, dropped from the lobby, or the room closed). */
  "room:removed": (payload: RemovedPayload) => void;
  /** The same session was opened elsewhere (e.g. another tab); this socket is closed. */
  "session:replaced": (payload: SessionReplacedPayload) => void;
  /** Errors for events sent without an ack. */
  "server:error": (payload: ErrorPayload) => void;
}

export type ClientEventName = keyof ClientToServerEvents;

/** Every client event name, for runtime checks (unknown events are dropped). */
export const CLIENT_EVENTS = [
  "room:create",
  "room:join",
  "room:resume",
  "room:leave",
  "lobby:updateSettings",
  "game:start",
  "game:ackRole",
  "game:nightAction",
  "game:vote",
  "game:restart",
  "chat:send",
  "time:sync",
] as const satisfies readonly ClientEventName[];

// Compile-time check that CLIENT_EVENTS lists every event.
type MissingClientEvents = Exclude<ClientEventName, (typeof CLIENT_EVENTS)[number]>;
const allClientEventsListed: MissingClientEvents extends never ? true : never = true;
void allClientEventsListed;
