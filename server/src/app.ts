import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { createConsoleLogger, type Logger } from "./logger.js";
import { MemoryRoomStore, type RoomStore } from "./rooms/roomStore.js";
import { RoomService, type RoomServiceOptions } from "./rooms/roomService.js";
import { TimeoutScheduler } from "./rooms/scheduler.js";
import { SocketBroadcaster } from "./socket/broadcaster.js";
import { attachSocketHandlers } from "./socket/handlers.js";
import { Presence } from "./socket/presence.js";
import { DEFAULT_RATE_LIMITS, RateLimiter, type RateLimitConfig } from "./socket/rateLimiter.js";
import type { MafiaServer } from "./socket/types.js";

export interface MafiaServerOptions {
  /** Folder with the built client, or null to serve no static files. */
  clientDist?: string | null;
  logger?: Logger;
  store?: RoomStore;
  clock?: () => number;
  rateLimits?: Partial<RateLimitConfig>;
  disconnectGraceMs?: number;
  sweepIntervalMs?: number;
  trustProxyHops?: number;
  service?: Partial<Pick<RoomServiceOptions, "maxRooms" | "emptyRoomTtlMs" | "idleRoomTtlMs" | "lobbyDropMs" | "rng">>;
}

export interface MafiaServerInstance {
  app: Express;
  httpServer: HttpServer;
  io: MafiaServer;
  service: RoomService;
  close(): Promise<void>;
}

/** Builds the HTTP + Socket.IO server without listening, so tests can run it on a random port. */
export function createMafiaServer(options: MafiaServerOptions = {}): MafiaServerInstance {
  const logger = options.logger ?? createConsoleLogger();
  const clock = options.clock ?? Date.now;
  const trustProxyHops = options.trustProxyHops ?? 0;

  const app = express();
  app.disable("x-powered-by");
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  const clientDist = options.clientDist ?? null;
  if (clientDist && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => {
      res.sendFile("index.html", { root: clientDist });
    });
  } else if (clientDist) {
    logger.warn("client.missing", { path: clientDist, hint: "run npm run build, or use npm run dev" });
  }

  const httpServer = createServer(app);
  const io: MafiaServer = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
  });

  const scheduler = new TimeoutScheduler(clock);
  const service = new RoomService({
    store: options.store ?? new MemoryRoomStore(),
    broadcaster: new SocketBroadcaster(io),
    scheduler,
    logger,
    clock,
    ...options.service,
  });
  const limiter = new RateLimiter({ ...DEFAULT_RATE_LIMITS, ...options.rateLimits }, clock);
  const presence = new Presence();

  attachSocketHandlers(io, {
    service,
    logger,
    limiter,
    presence,
    clock,
    disconnectGraceMs: options.disconnectGraceMs ?? 5_000,
    trustProxyHops,
  });

  const sweep = setInterval(() => {
    void service.sweep();
    limiter.prune(10 * 60_000);
  }, options.sweepIntervalMs ?? 60_000);
  sweep.unref();

  return {
    app,
    httpServer,
    io,
    service,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweep);
        scheduler.clearAll();
        presence.clear();
        io.close(() => resolve());
      }),
  };
}
