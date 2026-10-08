import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@mafia/shared";

const PORT = Number(process.env.PORT) || 3000;
const here = path.dirname(fileURLToPath(import.meta.url));
// server/dist/index.js -> client/dist
const clientDist = path.resolve(here, "../../client/dist");

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback for anything that isn't a file or a socket route.
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  console.warn(`Client build not found at ${clientDist}. Run "npm run build" (or use "npm run dev").`);
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

io.on("connection", (socket) => {
  socket.emit("hello", { message: "Hello from the server!", serverTime: new Date().toISOString() });
  socket.on("ping", (ack) => {
    if (typeof ack === "function") ack(new Date().toISOString());
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Mafia server listening on port ${PORT}`);
});

function shutdown() {
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
