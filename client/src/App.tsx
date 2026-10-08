import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@mafia/shared";

type Status = "connecting" | "connected" | "disconnected";

export function App() {
  const [status, setStatus] = useState<Status>("connecting");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("hello", (payload) => setMessage(payload.message));
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
      {message && <p className="message">{message}</p>}
    </main>
  );
}
