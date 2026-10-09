import {
  CLIENT_EVENTS,
  type AckResult,
  DEV_EVENTS,
  type ClientEventName,
  type ErrorCode,
  type GameErrorCode,
  type SessionInfo,
} from "@mafia/shared";
import type { Logger } from "../logger.js";
import { digest } from "../rooms/ids.js";
import { KeyedMutex } from "../rooms/keyedMutex.js";
import type { PlayerAction, RoomService, ServiceResult } from "../rooms/roomService.js";
import type { Presence } from "./presence.js";
import type { DevTools } from "../dev/devTools.js";
import type { RateCategory, RateLimiter } from "./rateLimiter.js";
import { playerRoom, type MafiaServer, type MafiaSocket } from "./types.js";
import {
  parseChat,
  parseCheckSeat,
  parseFillBots,
  parseReaction,
  parseReviewAvatar,
  parseSetReady,
  parseSkipDiscussion,
  parseCreateRoom,
  parseEmpty,
  parseJoinRoom,
  parseNarratorSubmit,
  parseNightAction,
  parsePeekRoom,
  parseResume,
  parseSetPassword,
  parseSettingsPatch,
  parseTargetPlayer,
  parseTimeSync,
  parseUpdateProfile,
  parseVote,
  type Parsed,
} from "./validate.js";

export interface SocketHandlerOptions {
  service: RoomService;
  logger: Logger;
  limiter: RateLimiter;
  presence: Presence;
  clock: () => number;
  /** How long a dropped connection may come back before the player is marked gone (60 s by default). */
  disconnectGraceMs: number;
  /** Proxies in front of the server that append to X-Forwarded-For (1 on Render, 0 locally). */
  trustProxyHops: number;
  /** Open sockets allowed per IP at once (a party on one Wi-Fi shares an IP). */
  maxSocketsPerIp: number;
  /** Present only in development: answers the dev:* events. In production they're unknown events. */
  devTools?: DevTools;
}

type Reply<T> = (result: AckResult<T>) => void;
type HandlerResult<T> = ServiceResult<T> & { afterAck?: () => Promise<void> };
interface Session {
  roomCode: string;
  playerId: string;
}

const CLIENT_EVENT_SET = new Set<string>(CLIENT_EVENTS);
const DEV_EVENT_SET = new Set<string>(DEV_EVENTS);

/** Problems with the request itself; worth logging with who sent it. Game-rule rejections are logged by the service. */
const TRANSPORT_CODES = new Set<ErrorCode>([
  "BAD_REQUEST",
  "RATE_LIMITED",
  "NOT_IN_ROOM",
  "SESSION_INVALID",
  "SERVER_BUSY",
  "SERVER_ERROR",
]);
const isGameCode = (code: ErrorCode): code is GameErrorCode => !TRANSPORT_CODES.has(code);

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
  const { service, logger, limiter, presence, clock, devTools } = options;
  /** Session changes (create/join/resume/leave) on one socket run one at a time. */
  const sessionQueue = new KeyedMutex();
  const socketsPerIp = new Map<string, number>();
  const lastLogged = new Map<string, number>();
  let loggedProxyShape = false;

  /** True at most once per key per window, so a flood can't flood the logs too. */
  const shouldLog = (key: string, windowMs: number): boolean => {
    const now = clock();
    const last = lastLogged.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    if (lastLogged.size > 10_000) lastLogged.clear();
    lastLogged.set(key, now);
    return true;
  };

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
    const refused =
      (socketsPerIp.get(ip) ?? 0) >= options.maxSocketsPerIp
        ? "too_many_sockets"
        : !limiter.consume(`ip:${ip}`, "connection")
          ? "rate"
          : null;
    if (refused) {
      if (shouldLog(`refused:${ip}`, 60_000)) logger.warn("connection.refused", { ip, reason: refused });
      next(new Error("RATE_LIMITED"));
      // Close the transport too, or one WebSocket could keep sending CONNECT packets.
      setTimeout(() => socket.conn.close(), 0);
      return;
    }
    next();
  });

  io.on("connection", (socket) => {
    const ip = socket.data.ip;
    socketsPerIp.set(ip, (socketsPerIp.get(ip) ?? 0) + 1);

    /** At most one warning per socket and key every 10 s. */
    const warnThrottled = (kind: string, fields: Record<string, string | undefined>, key = kind) => {
      if (!shouldLog(`${socket.id}:${key}`, 10_000)) return;
      logger.warn(kind, { socket: socket.id, ip: socket.data.ip, ...fields });
    };

    socket.emit("server:hello", { serverNow: clock() });

    // Runs before every handler: drop unknown events and cap the raw event rate.
    socket.use((packet, next) => {
      const [event] = packet;
      const last: unknown = packet[packet.length - 1];
      const ack = typeof last === "function" ? (last as Reply<never>) : undefined;
      if (typeof event !== "string" || !(CLIENT_EVENT_SET.has(event) || (devTools && DEV_EVENT_SET.has(event)))) {
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
          // Per player once seated, so a fresh socket (resume) doesn't get a fresh burst.
          const { roomCode, playerId } = socket.data;
          const seat = roomCode && playerId ? `seat:${roomCode}:${playerId}` : socket.id;
          const owner = config.perIp ? `ip:${socket.data.ip}` : seat;
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
            const code = result.error.code;
            if (!isGameCode(code)) warnThrottled("event.rejected", { ...where(), code }, `rejected:${code}`);
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

    const serially = <T>(task: () => Promise<T>): Promise<T> => sessionQueue.run(socket.id, task);

    /** Stops this socket speaking for its current seat. With `leaveRoom`, the seat is given up too. */
    const unbind = async (leaveRoom: boolean): Promise<void> => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) return;
      const wasActive = presence.release(roomCode, playerId, socket.id);
      await socket.leave(playerRoom(roomCode, playerId));
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      if (wasActive && leaveRoom) await service.leave(roomCode, playerId);
    };

    /** Makes this socket the member's connection, closing any older one (e.g. another tab). */
    const bind = async (info: SessionInfo): Promise<void> => {
      const { roomCode, playerId } = info;
      const replaced = presence.claim(roomCode, playerId, socket.id);
      if (replaced) {
        const old = io.sockets.sockets.get(replaced);
        if (old) {
          old.data.roomCode = undefined;
          old.data.playerId = undefined;
          await old.leave(playerRoom(roomCode, playerId));
          old.emit("session:replaced", { message: "This game was opened on another tab or device." });
          old.disconnect(true);
        }
        logger.info("session.replaced", { room: roomCode, player: playerId });
      }
      socket.data.roomCode = roomCode;
      socket.data.playerId = playerId;
      await socket.join(playerRoom(roomCode, playerId));
    };

    /** Switches this socket to a new seat. The old seat (if any, and different) is left only now that the new one exists. */
    const switchTo = async (info: SessionInfo): Promise<void> => {
      const { roomCode, playerId } = socket.data;
      const same = roomCode === info.roomCode && playerId === info.playerId;
      if (!same) {
        await unbind(true);
        await bind(info);
      } else if (!presence.isActive(info.roomCode, info.playerId, socket.id)) {
        await bind(info);
      }
    };

    /** After the ack: mark the member present and send their view and chat history. */
    const sync = (info: SessionInfo) => async () => {
      await service.setConnected(info.roomCode, info.playerId, true);
      await service.sendSnapshot(info.roomCode, info.playerId);
    };

    // ---------------------------------------------------------------- joining

    on("room:create", { category: "createRoom", perIp: true, parse: parseCreateRoom }, (p) =>
      serially(async () => {
        const result = await service.createRoom(p.name, p.avatar, {
          customCode: p.customCode,
          password: p.password,
          settings: p.settings,
          ownerKey: digest(`owner:${socket.data.ip}`),
        });
        if (!result.ok) return result;
        await switchTo(result.value);
        return { ...result, afterAck: sync(result.value) };
      }),
    );

    on("room:peek", { category: "joinRoom", perIp: true, parse: parsePeekRoom }, (p) => service.peek(p.roomCode));

    on("room:checkSeat", { category: "resume", perIp: true, parse: parseCheckSeat }, (p) =>
      service.checkSeat(p.roomCode, p.sessionToken),
    );

    on("room:join", { category: "joinRoom", perIp: true, parse: parseJoinRoom }, (p) =>
      serially(async () => {
        const result = await service.joinRoom(p.roomCode, p.name, p.avatar, p.password);
        if (!result.ok) return result;
        await switchTo(result.value);
        return { ...result, afterAck: sync(result.value) };
      }),
    );

    on("room:resume", { category: "resume", perIp: true, parse: parseResume }, (p) =>
      serially(async () => {
        const result = await service.resumeSession(p.roomCode, p.sessionToken);
        if (!result.ok) return result;
        await switchTo(result.value);
        logger.info("session.resumed", { room: p.roomCode, player: result.value.playerId });
        return { ...result, afterAck: sync(result.value) };
      }),
    );

    on("room:leave", { category: "hostAction", parse: parseEmpty }, () =>
      serially(() =>
        withSession(async (s) => {
          const result = await service.leave(s.roomCode, s.playerId);
          if (result.ok) await unbind(false);
          return result;
        }),
      ),
    );

    on("player:updateProfile", { category: "hostAction", parse: parseUpdateProfile }, (p) =>
      act((s) => ({ type: "UPDATE_PROFILE", playerId: s.playerId, name: p.name, avatar: p.avatar })),
    );

    on("player:setReady", { category: "gameAction", parse: parseSetReady }, (p) =>
      act((s) => ({ type: "SET_READY", playerId: s.playerId, ready: p.ready })),
    );

    on("player:removeAvatar", { category: "hostAction", parse: parseEmpty }, () =>
      withSession((s) => service.removeAvatar(s.roomCode, s.playerId, s.playerId)),
    );

    // ---------------------------------------------------------------- host controls

    on("host:updateSettings", { category: "hostAction", parse: parseSettingsPatch }, (settings) =>
      act((s) => ({ type: "UPDATE_SETTINGS", playerId: s.playerId, settings })),
    );

    on("host:start", { category: "hostAction", parse: parseEmpty }, () =>
      act((s) => ({ type: "START_GAME", playerId: s.playerId })),
    );

    on("host:restart", { category: "hostAction", parse: parseEmpty }, () =>
      act((s) => ({ type: "RESTART", playerId: s.playerId })),
    );

    on("host:kick", { category: "hostAction", parse: parseTargetPlayer }, (p) =>
      act((s) => ({ type: "KICK", playerId: s.playerId, targetId: p.playerId })),
    );

    on("host:transfer", { category: "hostAction", parse: parseTargetPlayer }, (p) =>
      act((s) => ({ type: "TRANSFER_HOST", playerId: s.playerId, targetId: p.playerId })),
    );

    on("host:setPassword", { category: "hostAction", parse: parseSetPassword }, (p) =>
      withSession((s) => service.setPassword(s.roomCode, s.playerId, p.password)),
    );

    on("host:reviewAvatar", { category: "hostAction", parse: parseReviewAvatar }, (p) =>
      withSession((s) => service.reviewAvatar(s.roomCode, s.playerId, p.playerId, p.approve)),
    );

    on("host:removeAvatar", { category: "hostAction", parse: parseTargetPlayer }, (p) =>
      withSession((s) => service.removeAvatar(s.roomCode, s.playerId, p.playerId)),
    );

    on("host:pause", { category: "hostAction", parse: parseEmpty }, () => act((s) => ({ type: "PAUSE", playerId: s.playerId })));
    on("host:resume", { category: "hostAction", parse: parseEmpty }, () => act((s) => ({ type: "RESUME", playerId: s.playerId })));
    on("host:addTime", { category: "hostAction", parse: parseEmpty }, () => act((s) => ({ type: "ADD_TIME", playerId: s.playerId })));
    on("host:skipToVoting", { category: "hostAction", parse: parseEmpty }, () =>
      act((s) => ({ type: "SKIP_TO_VOTING", playerId: s.playerId })),
    );

    // ---------------------------------------------------------------- playing

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

    on("game:skipDiscussion", { category: "gameAction", parse: parseSkipDiscussion }, (p) =>
      act((s) => ({ type: "SKIP_DISCUSSION", playerId: s.playerId, skip: p.skip })),
    );

    on("chat:send", { category: "chat", parse: parseChat }, (p) =>
      withSession((s) => service.sendChat(s.roomCode, s.playerId, p.text)),
    );
    on("chat:react", { category: "chat", parse: parseReaction }, (p) =>
      withSession((s) => service.sendReaction(s.roomCode, s.playerId, p.reaction)),
    );

    on("narrator:submit", { category: "gameAction", parse: parseNarratorSubmit }, (p) =>
      withSession((s) => service.submitNarration(s.roomCode, s.playerId, p.requestId, p.text)),
    );

    if (devTools) {
      on("dev:fillBots", { category: "hostAction", parse: parseFillBots }, (p) =>
        withSession((s) => devTools.bots.addBots(s.roomCode, s.playerId, p.count)),
      );
      on("dev:debugState", { category: "gameAction", parse: () => ({ ok: true, value: {} }) }, () =>
        withSession((s) => devTools.debugSnapshot(s.roomCode, s.playerId)),
      );
    }

    on("time:sync", { category: "timeSync", parse: parseTimeSync }, async (p) => ({
      ok: true,
      value: { clientSentAt: p.clientSentAt, serverNow: clock() },
    }));

    // ---------------------------------------------------------------- disconnects

    socket.on("disconnect", () => {
      limiter.forget(socket.id);
      const open = (socketsPerIp.get(ip) ?? 1) - 1;
      if (open > 0) socketsPerIp.set(ip, open);
      else socketsPerIp.delete(ip);
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) return;
      if (!presence.release(roomCode, playerId, socket.id)) return;
      const report = (step: string) => (r: ServiceResult<null>) => {
        if (!r.ok && r.error.code !== "ROOM_NOT_FOUND" && r.error.code !== "NOT_IN_ROOM") {
          logger.warn(`player.${step}_failed`, { room: roomCode, player: playerId, code: r.error.code });
        }
      };
      const crash = (step: string) => (err: unknown) =>
        logger.error(`player.${step}_failed`, { room: roomCode, player: playerId }, err);
      // Shown as "reconnecting" at once; only marked gone if they don't come back in time.
      service.markReconnecting(roomCode, playerId).then(report("reconnecting"), crash("reconnecting"));
      presence.startGrace(roomCode, playerId, options.disconnectGraceMs, () => {
        service.setConnected(roomCode, playerId, false).then(report("disconnect"), crash("disconnect"));
      });
    });
  });
}
