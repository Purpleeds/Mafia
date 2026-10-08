import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMafiaServer } from "./app.js";
import { createConsoleLogger } from "./logger.js";

const logger = createConsoleLogger();
const port = Number(process.env.PORT) || 3000;
const here = path.dirname(fileURLToPath(import.meta.url));

// Render puts one proxy in front of the service (and sets RENDER=true).
const trustProxyHops = process.env.TRUST_PROXY_HOPS
  ? Number(process.env.TRUST_PROXY_HOPS)
  : process.env.RENDER === "true"
    ? 1
    : 0;

const server = createMafiaServer({
  // server/dist/index.js -> client/dist
  clientDist: path.resolve(here, "../../client/dist"),
  logger,
  trustProxyHops,
});

// Re-arm timers for rooms a persistent store kept across a restart (none with the in-memory store).
void server.service.recover().catch((err: unknown) => logger.error("rooms.recover_failed", {}, err));

server.httpServer.listen(port, "0.0.0.0", () => {
  logger.info("server.listening", { port, node: process.version, trustProxyHops });
});

process.on("unhandledRejection", (reason) => logger.error("process.unhandled_rejection", {}, reason));
process.on("uncaughtException", (err) => logger.error("process.uncaught_exception", {}, err));

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server.shutdown", { signal });
  void server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
