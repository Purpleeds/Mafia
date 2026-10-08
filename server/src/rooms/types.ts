import type { ChatMessage } from "@mafia/shared";
import type { GameState } from "../game/index.js";

/**
 * Everything the server keeps about one room. Plain JSON so a store can
 * serialise it (e.g. to Redis) without special handling.
 */
export interface Room {
  code: string;
  state: GameState;
  /** scrypt hash of the room password, or null for an open room. */
  passwordHash: string | null;
  /** Hash of the creator's IP, to cap how many rooms one address keeps open. Never the IP itself. */
  ownerKey: string | null;
  /** sha256(sessionToken) -> member id. Raw tokens are never stored. */
  sessions: Record<string, string>;
  chat: ChatMessage[];
  createdAt: number;
  /** Last time a person did something (timer ticks don't count). */
  lastActivityAt: number;
  /** When the last connected member went away; null while anyone is connected. */
  emptySince: number | null;
  /** member id -> when they were marked disconnected (used to tidy the lobby). */
  disconnectedAt: Record<string, number>;
  /** member id -> when their connection dropped; they still count as present during the grace period. */
  reconnecting: Record<string, number>;
  /**
   * member id -> the last update sent to them. Updates only go out when what
   * that member can see has changed, and `version` counts only those updates,
   * so nobody can detect activity hidden from them.
   */
  delivery: Record<string, { version: number; hash: string }>;
}
