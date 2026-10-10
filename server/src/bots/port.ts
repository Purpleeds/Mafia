/**
 * The only doors between the bots and the game.
 *
 *  - BotSink: the room service hands a bot seat exactly what it sends that
 *    seat's socket (its personal game:state payload, the chat messages it may
 *    read, its chat history), plus two things that are the bot's own or
 *    public: its personality, and what players said in the public chat
 *    (`heard`, the same events for every bot in the room).
 *  - BotPort: everything a bot can do, as the same validated actions a human
 *    sends, and `botSay`: a message it wants to post. The service checks the
 *    seat really is played by a bot and runs everything through the engine and
 *    the chat rules exactly like a socket event.
 *
 * The bot module only uses the payload types from @mafia/shared. It never gets
 * the room store, the server's GameState, or anyone else's view (a test checks
 * its imports).
 */
import type {
  ChatHistoryPayload,
  ChatMessage,
  ChatReaction,
  ContradictionKind,
  ErrorPayload,
  GameStatePayload,
  QuestionTopic,
  Role,
  SpeechAct,
  SpeechReason,
  SpeechTone,
} from "@mafia/shared";
import type { Heard } from "./heard.js";
import type { BotPersonality } from "./personality.js";

export interface BotSink {
  /** The seat is played by a bot from now on, with this personality (sent before its first state). */
  attach(roomCode: string, seatId: string, personality: BotPersonality): void;
  /** The seat's view changed (the same payload as the game:state event). */
  state(roomCode: string, seatId: string, payload: GameStatePayload): void;
  /** A chat message this seat may read (the same as the chat:message event). */
  chat(roomCode: string, seatId: string, message: ChatMessage): void;
  /** The chat history this seat may read (the same as the chat:history event). */
  chatHistory(roomCode: string, seatId: string, payload: ChatHistoryPayload): void;
  /** What was said in the room's public chat (claims, accusations, questions...). Public: every bot gets the same. */
  heard(roomCode: string, events: readonly Heard[]): void;
  /** The seat is no longer played by a bot (removed, the room closed, or its player came back). */
  release(roomCode: string, seatId: string): void;
}

/** What a bot may do: the player actions a human client could send for its own seat. */
export type BotAction =
  | { type: "SET_READY"; ready: boolean }
  | { type: "ACK_ROLE" }
  | { type: "NIGHT_ACTION"; targetId: string; secondTargetId?: string }
  | { type: "CAST_VOTE"; targetId: string }
  | { type: "SKIP_DISCUSSION"; skip: boolean };

/**
 * A message a bot has decided to post. Ids, not names; the service turns it
 * into a public SpeechIntent for the host's AI. Nothing in it says whether it
 * is true: the strategy decided that, and it stays in the bot.
 */
export interface BotIntent {
  act: SpeechAct;
  targetId?: string;
  aboutId?: string;
  role?: Role;
  result?: "mafia" | "innocent";
  night?: number;
  reason?: SpeechReason;
  contradiction?: ContradictionKind;
  topic?: QuestionTopic;
  tone: SpeechTone;
  /** The public message it answers. */
  replyToMessageId?: string;
  /** The ready-made line (the meaning the AI keeps, and the fallback). */
  says: string;
}

export type BotResult = { ok: true; value: null } | { ok: false; error: ErrorPayload };

export interface BotPort {
  botAct(roomCode: string, seatId: string, action: BotAction): Promise<BotResult>;
  /** Queue a message: "typing…" shows, then it is posted in the channel the seat may write in. */
  botSay(roomCode: string, seatId: string, intent: BotIntent): Promise<BotResult>;
  botReact(roomCode: string, seatId: string, reaction: ChatReaction): Promise<BotResult>;
}
