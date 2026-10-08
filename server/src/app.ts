import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { DevTools } from "./dev/devTools.js";
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
  maxSocketsPerIp?: number;
  /**
   * Development tools: bots, the debug panel and relaxed room limits. index.ts
   * turns them on only outside production; they are off by default.
   */
  devTools?: boolean;
  service?: Partial<
    Pick<
      RoomServiceOptions,
      "maxRooms" | "maxRoomsPerOwner" | "emptyRoomTtlMs" | "idleRoomTtlMs" | "idleLobbyTtlMs" | "lobbyDropMs" | "rng"
    >
  >;
}

export interface MafiaServerInstance {
  app: Express;
  httpServer: HttpServer;
  io: MafiaServer;
  service: RoomService;
  /** Set when dev tools are on. */
  devTools: DevTools | null;
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
  const dev = options.devTools === true;
  // The client asks this once at start-up to know whether to show its dev tools.
  app.get("/dev-config", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ dev });
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

  const store = options.store ?? new MemoryRoomStore();
  const scheduler = new TimeoutScheduler(clock);
  const service = new RoomService({
    store,
    broadcaster: new SocketBroadcaster(io),
    scheduler,
    logger,
    clock,
    // Testing alone means making rooms again and again.
    ...(dev ? { maxRoomsPerOwner: 50 } : {}),
    ...options.service,
  });
  const devTools = dev ? new DevTools({ service, store, logger, clock }) : null;
  devTools?.start();
  const devLimits: Partial<RateLimitConfig> = dev ? { createRoom: { capacity: 100, refillPerSecond: 1 } } : {};
  const limiter = new RateLimiter({ ...DEFAULT_RATE_LIMITS, ...devLimits, ...options.rateLimits }, clock);
  const presence = new Presence();

  attachSocketHandlers(io, {
    service,
    logger,
    limiter,
    presence,
    clock,
    disconnectGraceMs: options.disconnectGraceMs ?? 60_000,
    trustProxyHops,
    maxSocketsPerIp: options.maxSocketsPerIp ?? 200,
    ...(devTools ? { devTools } : {}),
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
    devTools,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweep);
        devTools?.stop();
        scheduler.clearAll();
        presence.clear();
        io.close(() => resolve());
      }),
  };
}
