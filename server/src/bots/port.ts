/**
 * The only two doors between the bots and the game.
 *
 *  - BotSink: the room service hands a bot seat exactly what it sends that
 *    seat's socket: its personal game:state payload, the chat messages it may
 *    read, and its chat history. Nothing else ever reaches a bot.
 *  - BotPort: everything a bot can do, as the same validated actions a human
 *    sends. The service checks the seat really is played by a bot and runs the
 *    action through the engine exactly like a socket event.
 *
 * The bot module only uses the payload types from @mafia/shared. It never gets
 * the room store, the server's GameState, or anyone else's view (a test checks
 * its imports).
 */
import type {
  ChatHistoryPayload,
  ChatMessage,
  ChatReaction,
  GameStatePayload,
  ErrorPayload,
} from "@mafia/shared";

export interface BotSink {
  /** The seat's view changed (the same payload as the game:state event). */
  state(roomCode: string, seatId: string, payload: GameStatePayload): void;
  /** A chat message this seat may read (the same as the chat:message event). */
  chat(roomCode: string, seatId: string, message: ChatMessage): void;
  /** The chat history this seat may read (the same as the chat:history event). */
  chatHistory(roomCode: string, seatId: string, payload: ChatHistoryPayload): void;
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

export type BotResult = { ok: true; value: null } | { ok: false; error: ErrorPayload };

export interface BotPort {
  botAct(roomCode: string, seatId: string, action: BotAction): Promise<BotResult>;
  botChat(roomCode: string, seatId: string, text: string): Promise<BotResult>;
  botReact(roomCode: string, seatId: string, reaction: ChatReaction): Promise<BotResult>;
}
