import type {
  ChatHistoryPayload,
  ChatMessage,
  GameStatePayload,
  NarratorRequestPayload,
  RemovedPayload,
} from "@mafia/shared";
import type { Broadcaster } from "../rooms/roomService.js";
import { playerRoom, type MafiaServer } from "./types.js";

/** Sends to one player's private room, so a player only ever receives their own data. */
export class SocketBroadcaster implements Broadcaster {
  constructor(private readonly io: MafiaServer) {}

  state(roomCode: string, playerId: string, payload: GameStatePayload): void {
    this.io.to(playerRoom(roomCode, playerId)).emit("game:state", payload);
  }

  chat(roomCode: string, playerId: string, message: ChatMessage): void {
    this.io.to(playerRoom(roomCode, playerId)).emit("chat:message", message);
  }

  chatHistory(roomCode: string, playerId: string, payload: ChatHistoryPayload): void {
    this.io.to(playerRoom(roomCode, playerId)).emit("chat:history", payload);
  }

  /** Only the host's private room gets this; nobody else is ever sent the facts. */
  narrationRequest(roomCode: string, playerId: string, payload: NarratorRequestPayload): void {
    this.io.to(playerRoom(roomCode, playerId)).emit("narrator:request", payload);
  }

  removed(roomCode: string, playerId: string, payload: RemovedPayload): void {
    const room = playerRoom(roomCode, playerId);
    this.io.to(room).emit("room:removed", payload);
    this.io.in(room).socketsLeave(room);
  }
}
