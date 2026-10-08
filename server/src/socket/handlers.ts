import {
  CLIENT_EVENTS,
  type AckResult,
  type ClientEventName,
  type ErrorCode,
  type SessionInfo,
} from "@mafia/shared";
import type { Logger } from "../logger.js";
import type { PlayerAction, RoomService, ServiceResult } from "../rooms/roomService.js";
import type { Presence } from "./presence.js";
import type { RateCategory, RateLimiter } from "./rateLimiter.js";
import { playerRoom, type MafiaServer, type MafiaSocket } from "./types.js";
import {
  parseChat,
  parseCreateRoom,
  parseEmpty,
  parseJoinRoom,
  parseNightAction,
  parseResume,
  parseSettingsPatch,
  parseTimeSync,
  parseVote,
  type Parsed,
} from "./validate.js";

export interface SocketHandlerOptions {
  service: RoomService;
  logger: Logger;
  limiter: RateLimiter;
  presence: Presence;
  clock: () => number;
  /** How long a dropped connection may come back before the player is marked disconnected. */
  disconnectGraceMs: number;
  /** Proxies in front of the server that append to X-Forwarded-For (1 on Render, 0 locally). */
  trustProxyHops: number;
}

type Reply<T> = (result: AckResult<T>) => void;
type HandlerResult<T> = ServiceResult<T> & { afterAck?: () => Promise<void> };
interface Session {
  roomCode: string;
  playerId: string;
}

const CLIENT_EVENT_SET = new Set<string>(CLIENT_EVENTS);

const failure = (code: ErrorCode, message: string): AckResult<never> => ({ ok: false, error: { code, message } });
const notInRoom = <T>(): ServiceResult<T> => ({
  ok: false,
  error: { code: "NOT_IN_ROOM", message: "Join a room first." },
});

/** The client's IP, taking the entry our own proxies added to X-Forwarded-For. */
export function clientIp(socket: MafiaSocket, trustProxyHops: number): string {
  if (trustProxyHops > 0) {
    const header = socket.handshake.headers["x-forwarded-for"];
    const value = Array.isArray(header) ? header.join(",") : header;
    const parts = (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = parts[Math.max(0, parts.length - trustProxyHops)];
    if (ip) return ip;
  }
  return socket.handshake.address || "unknown";
}

export function attachSocketHandlers(io: MafiaServer, options: SocketHandlerOptions): void {
  const { service, logger, limiter, presence, clock } = options;
  let loggedProxyShape = false;

  io.use((socket, next) => {
    const ip = clientIp(socket, options.trustProxyHops);
    socket.data.ip = ip;
    if (!loggedProxyShape) {
      // Once per process, to check the proxy hop setting against reality (no IPs logged).
      const xff = socket.handshake.headers["x-forwarded-for"];
      const entries = typeof xff === "string" ? xff.split(",").length : 0;
      logger.info("connection.proxy_shape", { xffEntries: entries, trustProxyHops: options.trustProxyHops });
      loggedProxyShape = true;
    }
    if (!limiter.consume(`ip:${ip}`, "connection")) {
      logger.warn("connection.rate_limited", { ip });
      next(new Error("RATE_LIMITED"));
      return;
    }
    next();
  });

  io.on("connection", (socket) => {
    const lastWarned = new Map<string, number>();
    /** At most one warning per socket and kind every 10 s, so floods don't flood the logs too. */
    const warnThrottled = (kind: string, fields: Record<string, string | undefined>) => {
      const now = clock();
      if (now - (lastWarned.get(kind) ?? -Infinity) < 10_000) return;
      lastWarned.set(kind, now);
      logger.warn(kind, { socket: socket.id, ip: socket.data.ip, ...fields });
    };

    socket.emit("server:hello", { serverNow: clock() });

    // Runs before every handler: drop unknown events and cap the raw event rate.
    socket.use((packet, next) => {
      const [event] = packet;
      const last: unknown = packet[packet.length - 1];
      const ack = typeof last === "function" ? (last as Reply<never>) : undefined;
      if (typeof event !== "string" || !CLIENT_EVENT_SET.has(event)) {
        warnThrottled("event.unknown", { event: String(event).slice(0, 40) });
        ack?.(failure("BAD_REQUEST", "Unknown event."));
        return;
      }
      if (!limiter.consume(socket.id, "anyEvent")) {
        warnThrottled("event.rate_limited", { event, category: "anyEvent" });
        ack?.(failure("RATE_LIMITED", "Slow down a little."));
        return;
      }
      next();
    });

    const currentSession = (): Session | null => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) return null;
      // Replaced by another tab, or removed from the room.
      if (!presence.isActive(roomCode, playerId, socket.id)) return null;
      if (!socket.rooms.has(playerRoom(roomCode, playerId))) return null;
      return { roomCode, playerId };
    };

    /**
     * Registers a handler: rate limit, then shape-check the payload, then run.
     * The reply goes to the ack, or to `server:error` if the client sent none.
     */
    const on = <P, R>(
      event: ClientEventName,
      config: { category: RateCategory; perIp?: boolean; parse: (raw: unknown) => Parsed<P> },
      run: (payload: P) => Promise<HandlerResult<R>>,
    ): void => {
      const untyped = socket as unknown as { on(event: string, listener: (...args: unknown[]) => void): void };
      untyped.on(event, (...args: unknown[]) => {
        const last = args[args.length - 1];
        const ack = typeof last === "function" ? (args.pop() as Reply<R>) : undefined;
        const reply = (result: AckResult<R>) => {
          if (ack) ack(result);
          else if (!result.ok) socket.emit("server:error", result.error);
        };
        const where = () => ({ event, room: socket.data.roomCode, player: socket.data.playerId });

        void (async () => {
          const owner = config.perIp ? `ip:${socket.data.ip}` : socket.id;
          if (!limiter.consume(owner, config.category)) {
            warnThrottled("event.rate_limited", { event, category: config.category });
            reply(failure("RATE_LIMITED", "You're doing that too often. Wait a moment."));
            return;
          }
          const parsed = config.parse(args[0]);
          if (!parsed.ok) {
            warnThrottled("event.bad_request", { event });
            reply(failure("BAD_REQUEST", parsed.message));
            return;
          }
          let result: HandlerResult<R>;
          try {
            result = await run(parsed.value);
          } catch (err) {
            logger.error("event.failed", where(), err);
            reply(failure("SERVER_ERROR", "Something went wrong on the server."));
            return;
          }
          if (!result.ok) {
            logger.warn("event.rejected", { ...where(), code: result.error.code });
            reply({ ok: false, error: result.error });
            return;
          }
          reply({ ok: true, data: result.value });
          if (result.afterAck) {
            try {
              await result.afterAck();
            } catch (err) {
              logger.error("event.after_ack_failed", where(), err);
            }
          }
        })();
      });
    };

    const withSession = async <R>(fn: (s: Session) => Promise<ServiceResult<R>>): Promise<ServiceResult<R>> => {
      const session = currentSession();
      return session ? fn(session) : notInRoom<R>();
    };

    const act = (build: (s: Session) => PlayerAction) =>
      withSession((s) => service.act(s.roomCode, build(s)));

    /** Leaves whatever room this socket speaks for, unless it is `keep`. */
    const unbindCurrent = async (keep?: Session): Promise<void> => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) return;
      if (keep && keep.roomCode === roomCode && keep.playerId === playerId) return;
      const wasActive = presence.release(roomCode, playerId, socket.id);
      await socket.leave(playerRoom(roomCode, playerId));
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      // Switching to another room counts as leaving this one.
      if (wasActive) await service.leave(roomCode, playerId);
    };

    /** Makes this socket the player's connection, closing any older one (e.g. another tab). */
    const bind = async (info: SessionInfo): Promise<void> => {
      const { roomCode, playerId } = info;
      const replaced = presence.claim(roomCode, playerId, socket.id);
      if (replaced) {
        const old = io.sockets.sockets.get(replaced);
        if (old) {
          old.data.roomCode = undefined;
          old.data.playerId = undefined;
          await old.leave(playerRoom(roomCode, playerId));
          old.emit("session:replaced", { message: "This game was opened somewhere else." });
          old.disconnect(true);
        }
        logger.info("session.replaced", { room: roomCode, player: playerId });
      }
      socket.data.roomCode = roomCode;
      socket.data.playerId = playerId;
      await socket.join(playerRoom(roomCode, playerId));
    };

    /** After the ack: mark the player connected and send their view and chat history. */
    const sync = (info: SessionInfo) => async () => {
      await service.setConnected(info.roomCode, info.playerId, true);
      await service.sendSnapshot(info.roomCode, info.playerId);
    };

    // ---------------------------------------------------------------- rooms

    on("room:create", { category: "createRoom", perIp: true, parse: parseCreateRoom }, async ({ name }) => {
      await unbindCurrent();
      const result = await service.createRoom(name);
      if (!result.ok) return result;
      await bind(result.value);
      return { ...result, afterAck: sync(result.value) };
    });

    on("room:join", { category: "joinRoom", perIp: true, parse: parseJoinRoom }, async ({ roomCode, name }) => {
      await unbindCurrent();
      const result = await service.joinRoom(roomCode, name);
      if (!result.ok) return result;
      await bind(result.value);
      return { ...result, afterAck: sync(result.value) };
    });

    on("room:resume", { category: "joinRoom", perIp: true, parse: parseResume }, async ({ roomCode, sessionToken }) => {
      const result = await service.resumeSession(roomCode, sessionToken);
      if (!result.ok) return result;
      await unbindCurrent(result.value);
      await bind(result.value);
      logger.info("session.resumed", { room: roomCode, player: result.value.playerId });
      return { ...result, afterAck: sync(result.value) };
    });

    on("room:leave", { category: "hostAction", parse: parseEmpty }, () =>
      withSession(async (s) => {
        const result = await service.leave(s.roomCode, s.playerId);
        if (result.ok) await unbindCurrent();
        return result;
      }),
    );

    // ---------------------------------------------------------------- lobby & game

    on("lobby:updateSettings", { category: "hostAction", parse: parseSettingsPatch }, (settings) =>
      act((s) => ({ type: "UPDATE_SETTINGS", playerId: s.playerId, settings })),
    );

    on("game:start", { category: "hostAction", parse: parseEmpty }, () =>
      act((s) => ({ type: "START_GAME", playerId: s.playerId })),
    );

    on("game:restart", { category: "hostAction", parse: parseEmpty }, () =>
      act((s) => ({ type: "RESTART", playerId: s.playerId })),
    );

    on("game:ackRole", { category: "gameAction", parse: parseEmpty }, () =>
      act((s) => ({ type: "ACK_ROLE", playerId: s.playerId })),
    );

    on("game:nightAction", { category: "gameAction", parse: parseNightAction }, (p) =>
      act((s) => ({
        type: "NIGHT_ACTION",
        playerId: s.playerId,
        targetId: p.targetId,
        secondTargetId: p.secondTargetId,
      })),
    );

    on("game:vote", { category: "gameAction", parse: parseVote }, (p) =>
      act((s) => ({ type: "CAST_VOTE", playerId: s.playerId, targetId: p.targetId })),
    );

    on("chat:send", { category: "chat", parse: parseChat }, (p) =>
      withSession((s) => service.sendChat(s.roomCode, s.playerId, p.channel, p.text)),
    );

    on("time:sync", { category: "timeSync", parse: parseTimeSync }, async (p) => ({
      ok: true,
      value: { clientSentAt: p.clientSentAt, serverNow: clock() },
    }));

    // ---------------------------------------------------------------- disconnects

    socket.on("disconnect", () => {
      limiter.forget(socket.id);
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) return;
      if (!presence.release(roomCode, playerId, socket.id)) return;
      presence.startGrace(roomCode, playerId, options.disconnectGraceMs, () => {
        service
          .setConnected(roomCode, playerId, false)
          .then((r) => {
            if (!r.ok && r.error.code !== "ROOM_NOT_FOUND" && r.error.code !== "NOT_IN_ROOM") {
              logger.warn("player.disconnect_failed", { room: roomCode, player: playerId, code: r.error.code });
            }
          })
          .catch((err: unknown) => logger.error("player.disconnect_failed", { room: roomCode, player: playerId }, err));
      });
    });
  });
}
