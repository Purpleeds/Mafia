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
import type { Avatar } from "./identity.js";
import type { NarrationFacts } from "./narration.js";

// ---------------------------------------------------------------- limits

export const MAX_CHAT_LENGTH = 300;

// ---------------------------------------------------------------- errors & acks

export type TransportErrorCode =
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "ROOM_NOT_FOUND"
  | "NOT_IN_ROOM"
  | "SESSION_INVALID"
  | "CHAT_NOT_ALLOWED"
  | "CODE_INVALID"
  | "CODE_TAKEN"
  | "PASSWORD_REQUIRED"
  | "WRONG_PASSWORD"
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
  avatar: Avatar;
  /** 4–8 letters or numbers; a random 4-letter code is used if omitted. */
  customCode?: string;
  /** Makes the room private. */
  password?: string;
}

export interface PeekRoomPayload {
  roomCode: string;
}

/** What the join screen needs to know before asking for a name. */
export interface RoomPreview {
  roomCode: string;
  hasPassword: boolean;
  stage: "lobby" | "in_game" | "game_over";
  playerCount: number;
  maxPlayers: number;
  /** In the lobby you join as a player; once a game has started, as a spectator. */
  joinAs: "player" | "spectator";
  /** No room for you as a player or spectator right now. */
  isFull: boolean;
}

export interface JoinRoomPayload {
  roomCode: string;
  name: string;
  avatar: Avatar;
  password?: string;
}

export interface ResumeSessionPayload {
  roomCode: string;
  sessionToken: string;
}

/**
 * Returned when you create, join or resume. Save it (e.g. localStorage) and send
 * room:resume with it after a refresh or reconnect to come back as the same player.
 */
export interface SessionInfo {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  seat: "player" | "spectator";
}

/** Lobby only. */
export interface UpdateProfilePayload {
  name?: string;
  avatar?: Avatar;
}

export interface TargetPlayerPayload {
  playerId: string;
}

export interface SetPasswordPayload {
  /** null removes the password. */
  password: string | null;
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

/**
 * A chat message. There is no channel here on purpose: the server decides where
 * it goes from the sender's role, status and the phase (see chatChannelFor).
 */
export interface ChatSendPayload {
  text: string;
}

/** The quick reactions for players who don't want to type. */
export const CHAT_REACTIONS = ["thinking", "suspicious", "laughing", "shocked"] as const;
export type ChatReaction = (typeof CHAT_REACTIONS)[number];

export interface ChatReactPayload {
  reaction: ChatReaction;
}

/**
 * The host's browser answers a narrator:request with the text its AI wrote, or
 * null if it couldn't (not signed in, an error, too slow). Either way the server
 * checks the text and falls back to a ready-made line when it isn't good.
 */
export interface NarratorSubmitPayload {
  requestId: string;
  text: string | null;
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
 * You only get an update when something you can see has changed.
 */
export interface RoomInfo {
  code: string;
  hasPassword: boolean;
}

export interface GameStatePayload {
  /** Counts only the updates sent to you; ignore a payload older than the one you have. */
  version: number;
  serverNow: number;
  room: RoomInfo;
  view: GameView;
}

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  senderId: string;
  senderName: string;
  /** Empty for a reaction. */
  text: string;
  /** Set when this is a quick reaction instead of typed text. */
  reaction?: ChatReaction;
  sentAt: number;
}

export interface ChatHistoryPayload {
  messages: ChatMessage[];
}

export type RemovedReason = "left" | "kicked" | "dropped" | "room_closed";

export interface RemovedPayload {
  reason: RemovedReason;
  message: string;
}

/**
 * Sent to the host's browser only (nobody else ever gets it): the public facts
 * to turn into a narration with puter.ai.chat(), and how long the server waits.
 */
export interface NarratorRequestPayload {
  requestId: string;
  facts: NarrationFacts;
  timeoutMs: number;
}

export interface SessionReplacedPayload {
  message: string;
}

// ---------------------------------------------------------------- event maps

export interface ClientToServerEvents {
  // joining
  "room:create": (payload: CreateRoomPayload, ack: Ack<SessionInfo>) => void;
  "room:peek": (payload: PeekRoomPayload, ack: Ack<RoomPreview>) => void;
  "room:join": (payload: JoinRoomPayload, ack: Ack<SessionInfo>) => void;
  "room:resume": (payload: ResumeSessionPayload, ack: Ack<SessionInfo>) => void;
  "room:leave": (payload: EmptyPayload, ack: Ack) => void;
  "player:updateProfile": (payload: UpdateProfilePayload, ack: Ack) => void;
  // host controls
  "host:updateSettings": (payload: SettingsPatch, ack: Ack) => void;
  "host:start": (payload: EmptyPayload, ack: Ack) => void;
  "host:restart": (payload: EmptyPayload, ack: Ack) => void;
  "host:kick": (payload: TargetPlayerPayload, ack: Ack) => void;
  "host:transfer": (payload: TargetPlayerPayload, ack: Ack) => void;
  "host:setPassword": (payload: SetPasswordPayload, ack: Ack) => void;
  // playing
  "game:ackRole": (payload: EmptyPayload, ack: Ack) => void;
  "game:nightAction": (payload: NightActionPayload, ack: Ack) => void;
  "game:vote": (payload: VotePayload, ack: Ack) => void;
  "chat:send": (payload: ChatSendPayload, ack: Ack) => void;
  "chat:react": (payload: ChatReactPayload, ack: Ack) => void;
  "narrator:submit": (payload: NarratorSubmitPayload, ack: Ack) => void;
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
  /** Host only: write the narration for these public facts (see NarratorRequestPayload). */
  "narrator:request": (payload: NarratorRequestPayload) => void;
  /** Errors for events sent without an ack. */
  "server:error": (payload: ErrorPayload) => void;
}

export type ClientEventName = keyof ClientToServerEvents;

/** Every client event name, for runtime checks (unknown events are dropped). */
export const CLIENT_EVENTS = [
  "room:create",
  "room:peek",
  "room:join",
  "room:resume",
  "room:leave",
  "player:updateProfile",
  "host:updateSettings",
  "host:start",
  "host:restart",
  "host:kick",
  "host:transfer",
  "host:setPassword",
  "game:ackRole",
  "game:nightAction",
  "game:vote",
  "chat:send",
  "chat:react",
  "narrator:submit",
  "time:sync",
] as const satisfies readonly ClientEventName[];

// Compile-time check that CLIENT_EVENTS lists every event.
type MissingClientEvents = Exclude<ClientEventName, (typeof CLIENT_EVENTS)[number]>;
const allClientEventsListed: MissingClientEvents extends never ? true : never = true;
void allClientEventsListed;
