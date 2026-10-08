import type { ChatMessage } from "@mafia/shared";
import type { GameState } from "../game/index.js";

/**
 * Everything the server keeps about one room. Plain JSON so a store can
 * serialise it (e.g. to Redis) without special handling.
 */
export interface Room {
  code: string;
  state: GameState;
  /** Increases on every state change; sent to clients so they can drop stale updates. */
  version: number;
  /** sha256(sessionToken) -> playerId. Raw tokens are never stored. */
  sessions: Record<string, string>;
  chat: ChatMessage[];
  nextMessageId: number;
  createdAt: number;
  /** Last time a person did something (timer ticks don't count). */
  lastActivityAt: number;
  /** When the last connected player went away; null while anyone is connected. */
  emptySince: number | null;
  /** playerId -> when they disconnected, used to tidy the lobby. */
  disconnectedAt: Record<string, number>;
}
