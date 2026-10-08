/**
 * The one Socket.IO connection for the whole app, plus a promise helper for
 * acknowledged events. Every client -> server event is `(payload, ack)`.
 */
import { io, type Socket } from "socket.io-client";
import type { AckResult, ClientToServerEvents, ServerToClientEvents } from "@mafia/shared";
import type { CallError } from "../lib/errors";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: GameSocket = io({
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
  // Polling first is the most reliable on flaky mobile networks; it upgrades to WebSocket.
  transports: ["polling", "websocket"],
});

export const CALL_TIMEOUT_MS = 8000;

type Events = ClientToServerEvents;
export type ClientEvent = keyof Events;
export type PayloadOf<E extends ClientEvent> = Parameters<Events[E]>[0];
export type AckDataOf<E extends ClientEvent> =
  Parameters<Events[E]>[1] extends (result: AckResult<infer T>) => void ? T : never;

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: CallError };

interface UntypedAckEmitter {
  timeout(ms: number): { emitWithAck(event: string, payload: unknown): Promise<unknown> };
}

function isAckResult(value: unknown): value is AckResult<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.ok === true) return "data" in v;
  if (v.ok === false) {
    const e = v.error as Record<string, unknown> | null | undefined;
    return typeof e === "object" && e !== null && typeof e.code === "string";
  }
  return false;
}

/**
 * Emits `event` and resolves with the server's AckResult. A timeout or a dropped
 * connection becomes a friendly `{ ok: false }` instead of a rejection.
 * While disconnected, Socket.IO buffers the event and sends it on reconnect
 * (dropping it again if the timeout passes first).
 */
export async function call<E extends ClientEvent>(event: E, payload: PayloadOf<E>): Promise<CallResult<AckDataOf<E>>> {
  try {
    const raw = await (socket as unknown as UntypedAckEmitter).timeout(CALL_TIMEOUT_MS).emitWithAck(event, payload);
    if (!isAckResult(raw)) {
      return { ok: false, error: { code: "SERVER_ERROR", message: "Unexpected answer from the server." } };
    }
    if (raw.ok) return { ok: true, data: raw.data as AckDataOf<E> };
    return { ok: false, error: { code: raw.error.code, message: raw.error.message } };
  } catch {
    return socket.connected
      ? { ok: false, error: { code: "TIMEOUT", message: "The server didn't answer in time." } }
      : { ok: false, error: { code: "OFFLINE", message: "Connection lost." } };
  }
}
