import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMafiaServer } from "./app.js";
import { devToolsEnabled } from "./dev/devTools.js";
import { createConsoleLogger } from "./logger.js";
import { connectKeyValue, type KeyValue } from "./rooms/keyValue.js";
import { PersistentRoomStore } from "./rooms/persistentStore.js";
import type { RoomStore } from "./rooms/roomStore.js";

const logger = createConsoleLogger();
const port = Number(process.env.PORT) || 3000;
const here = path.dirname(fileURLToPath(import.meta.url));

// Render puts one proxy in front of the service (and sets RENDER=true).
const trustProxyHops = process.env.TRUST_PROXY_HOPS
  ? Number(process.env.TRUST_PROXY_HOPS)
  : process.env.RENDER === "true"
    ? 1
    : 0;

// Rooms survive restarts and redeploys when a Key Value (Redis) instance is connected through REDIS_URL.
// Without it, or if it can't be reached at start-up, rooms live in memory only (as before).
let kv: KeyValue | null = null;
let store: RoomStore | undefined;
let persistent: PersistentRoomStore | null = null;
if (process.env.REDIS_URL) {
  try {
    kv = await connectKeyValue(process.env.REDIS_URL, logger);
    persistent = await PersistentRoomStore.open(kv, logger);
    store = persistent;
  } catch (err) {
    logger.warn("store.kv_unavailable", { fallback: "memory", error: err instanceof Error ? err.message : String(err) });
    await kv?.close();
    kv = null;
  }
} else {
  logger.info("store.ready", { kind: "memory", hint: "set REDIS_URL to keep rooms across restarts" });
}

const server = createMafiaServer({
  ...(store ? { store } : {}),
  // server/dist/index.js -> client/dist
  clientDist: path.resolve(here, "../../client/dist"),
  logger,
  trustProxyHops,
  devTools: devToolsEnabled(),
});

// Re-arm timers for rooms a persistent store kept across a restart (none with the in-memory store).
// Done before listening, so nobody who reconnects is then marked away by the recovery.
try {
  await server.service.recover();
} catch (err) {
  logger.error("rooms.recover_failed", {}, err);
}

server.httpServer.listen(port, "0.0.0.0", () => {
  logger.info("server.listening", { port, node: process.version, trustProxyHops, devTools: devToolsEnabled() });
});

process.on("unhandledRejection", (reason) => logger.error("process.unhandled_rejection", {}, reason));
process.on("uncaughtException", (err) => logger.error("process.uncaught_exception", {}, err));

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server.shutdown", { signal });
  // Let the last room saves reach Key Value before the process ends.
  void server
    .close()
    .then(() => persistent?.flush())
    .then(() => kv?.close())
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
