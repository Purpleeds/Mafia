import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@mafia/shared";

type Status = "connecting" | "connected" | "disconnected";

export function App() {
  const [status, setStatus] = useState<Status>("connecting");
  const [offsetMs, setOffsetMs] = useState<number | null>(null);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
    socket.on("connect", () => {
      setStatus("connected");
      // Estimate the server clock offset (countdowns never trust the local clock).
      socket.emit("time:sync", { clientSentAt: Date.now() }, (result) => {
        if (!result.ok) return;
        const now = Date.now();
        const latency = (now - result.data.clientSentAt) / 2;
        setOffsetMs(Math.round(result.data.serverNow + latency - now));
      });
    });
    socket.on("disconnect", () => setStatus("disconnected"));
    return () => {
      socket.close();
    };
  }, []);

  return (
    <main className="hello">
      <h1>Hello, Mafia!</h1>
      <p className={`status status-${status}`}>
        {status === "connected" ? "Connected to the server" : status === "connecting" ? "Connecting…" : "Disconnected"}
      </p>
      {offsetMs !== null && <p className="message">Server clock offset: {offsetMs} ms</p>}
    </main>
  );
}
