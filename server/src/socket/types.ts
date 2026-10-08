import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@mafia/shared";

export interface SocketData {
  ip: string;
  roomCode?: string;
  playerId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterServerEvents {}

export type MafiaServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type MafiaSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** Each player gets a private Socket.IO room; nothing is ever broadcast room-wide. */
export function playerRoom(roomCode: string, playerId: string): string {
  return `player:${roomCode}:${playerId}`;
}
