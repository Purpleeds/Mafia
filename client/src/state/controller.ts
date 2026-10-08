/**
 * Connection and session logic: wires the socket events into the store and
 * keeps you in your room across refreshes, locked phones and flaky networks.
 */
import type {
  CreateRoomPayload,
  GameStatePayload,
  JoinRoomPayload,
  RemovedPayload,
  SessionInfo,
} from "@mafia/shared";
import { friendlyError } from "../lib/errors";
import { goHome, goToRoom, parseRoute } from "../lib/router";
import { forgetSession, loadSession, saveProfile, saveSession } from "../lib/storage";
import { call, socket, type CallResult } from "../net/socket";
import { getState, setState, showToast } from "./store";

const MAX_CHAT_MESSAGES = 200;

/** The highest game:state version accepted on the current socket and session. */
let heldVersion = 0;
/** Bumped on every connect/disconnect so stale answers are ignored. */
let connectionEpoch = 0;
let resumeInFlight: { token: string; epoch: number } | null = null;
let resumeRetryTimer: number | undefined;
let resumeRetries = 0;
let manualReconnectTimer: number | undefined;
let initialized = false;

// ---------------------------------------------------------------- helpers

function clearRoomData(): void {
  heldVersion = 0;
  setState({ game: null, chat: [] });
}

/** Makes `info` the active session (after create, join or resume). */
function adoptSession(info: SessionInfo): void {
  const previous = getState().session;
  if (!previous || previous.roomCode !== info.roomCode) clearRoomData();
  // A fresh server-side counter starts after every join/resume.
  heldVersion = 0;
  saveSession(info);
  resumeRetries = 0;
  setState({ session: info, sessionStatus: "active", sessionError: null, notice: null });
}

/** Drops the active session everywhere (store and localStorage). */
function dropSession(roomCode: string): void {
  forgetSession(roomCode);
  window.clearTimeout(resumeRetryTimer);
  resumeInFlight = null;
  if (getState().session?.roomCode === roomCode) {
    clearRoomData();
    setState({ session: null, sessionStatus: "idle", sessionError: null });
  }
}

/** Is the address bar showing this room right now? (Don't yank people off other screens.) */
function isViewingRoom(roomCode: string): boolean {
  const route = parseRoute(window.location.pathname);
  return route.name === "room" && route.code === roomCode;
}

function canTalkToServer(): boolean {
  return socket.connected && getState().replaced === null;
}

// ---------------------------------------------------------------- resume

async function resume(): Promise<void> {
  const session = getState().session;
  if (!session || !canTalkToServer()) return;
  if (resumeInFlight && resumeInFlight.token === session.sessionToken && resumeInFlight.epoch === connectionEpoch) return;

  window.clearTimeout(resumeRetryTimer);
  const attempt = { token: session.sessionToken, epoch: connectionEpoch };
  resumeInFlight = attempt;
  setState({ sessionStatus: "resuming", sessionError: null });

  const result = await call("room:resume", { roomCode: session.roomCode, sessionToken: session.sessionToken });

  if (resumeInFlight !== attempt) return; // superseded by a newer attempt
  resumeInFlight = null;
  const current = getState().session;
  if (!current || current.sessionToken !== session.sessionToken) return; // switched rooms meanwhile
  if (attempt.epoch !== connectionEpoch) return; // the socket changed; the connect handler resumes again

  if (result.ok) {
    adoptSession(result.data);
    return;
  }

  const { code } = result.error;
  if (code === "ROOM_NOT_FOUND") {
    const viewing = isViewingRoom(session.roomCode);
    dropSession(session.roomCode);
    setState({
      notice: { roomCode: null, reason: "not_found", message: `Room ${session.roomCode} has closed.` },
    });
    if (viewing) goHome({ replace: true });
    return;
  }
  if (code === "SESSION_INVALID") {
    const viewing = isViewingRoom(session.roomCode);
    dropSession(session.roomCode);
    setState({
      notice: viewing
        ? {
            roomCode: session.roomCode,
            reason: "expired",
            message: "Your seat in this room has expired. Join again to keep playing.",
          }
        : { roomCode: null, reason: "expired", message: `Your seat in room ${session.roomCode} has expired.` },
    });
    return;
  }
  if (code === "OFFLINE") {
    // The connect handler will try again.
    setState({ sessionStatus: "resuming" });
    return;
  }
  setState({ sessionStatus: "error", sessionError: friendlyError(result.error) });
  if (resumeRetries < 3) {
    resumeRetries += 1;
    const delay = code === "RATE_LIMITED" ? 6000 : 2500 * resumeRetries;
    resumeRetryTimer = window.setTimeout(() => void resume(), delay);
  }
}

/** "Try again" on the rejoin screen. */
export function retryResume(): void {
  resumeRetries = 0;
  resumeInFlight = null;
  if (!socket.connected) {
    setState({ sessionStatus: "resuming", sessionError: null });
    socket.connect();
    return;
  }
  void resume();
}

/**
 * Called whenever the address bar shows a room. Uses the session already in
 * memory, or a saved one for that room (auto-rejoin after a refresh).
 * Returns nothing; the store tells the screens what to show.
 */
export function openRoom(code: string): void {
  const { session, sessionStatus } = getState();
  if (session && session.roomCode === code) {
    if (sessionStatus === "idle") void resume();
    return;
  }
  const saved = loadSession(code);
  if (!saved) return; // the join screen handles it
  window.clearTimeout(resumeRetryTimer);
  resumeInFlight = null;
  resumeRetries = 0;
  clearRoomData();
  setState({ session: saved, sessionStatus: "resuming", sessionError: null });
  void resume();
}

/** Forget the saved seat for this room and show the join form instead. */
export function abandonSavedSession(code: string): void {
  dropSession(code);
}

// ---------------------------------------------------------------- joining

export async function createRoom(payload: CreateRoomPayload): Promise<CallResult<SessionInfo>> {
  const result = await call("room:create", payload);
  if (result.ok) {
    clearRoomData();
    adoptSession(result.data);
    saveProfile({ name: payload.name, avatar: payload.avatar });
    goToRoom(result.data.roomCode);
  }
  return result;
}

export async function joinRoom(payload: JoinRoomPayload): Promise<CallResult<SessionInfo>> {
  const result = await call("room:join", payload);
  if (result.ok) {
    clearRoomData();
    adoptSession(result.data);
    saveProfile({ name: payload.name, avatar: payload.avatar });
    goToRoom(result.data.roomCode, { replace: true });
  }
  return result;
}

export async function leaveRoom(): Promise<CallResult<null>> {
  const session = getState().session;
  const result = await call("room:leave", {});
  if (session && (result.ok || result.error.code === "NOT_IN_ROOM" || result.error.code === "ROOM_NOT_FOUND")) {
    dropSession(session.roomCode);
    goHome();
    return { ok: true, data: null };
  }
  return result;
}

/** "Play here" after the session was opened somewhere else. */
export function takeOverSession(): void {
  setState({ replaced: null });
  resumeInFlight = null;
  if (socket.connected) void resume();
  else {
    if (getState().session) setState({ sessionStatus: "resuming" });
    socket.connect();
  }
}

// ---------------------------------------------------------------- server events

function onGameState(payload: GameStatePayload): void {
  const session = getState().session;
  if (!session || payload.room.code !== session.roomCode) return;
  if (payload.version < heldVersion) return;
  heldVersion = payload.version;
  setState({ game: { payload, receivedAt: performance.now() } });
}

function onRemoved(payload: RemovedPayload): void {
  const session = getState().session;
  const roomCode = session?.roomCode ?? null;
  const viewing = roomCode !== null && isViewingRoom(roomCode);
  if (roomCode) dropSession(roomCode);
  switch (payload.reason) {
    case "left":
      if (viewing) goHome();
      return;
    case "dropped":
      // Stay on /CODE: the join screen shows the message and lets you join again.
      setState({ notice: { roomCode: viewing ? roomCode : null, reason: payload.reason, message: payload.message } });
      return;
    case "kicked":
    case "room_closed":
      setState({ notice: { roomCode: null, reason: payload.reason, message: payload.message } });
      if (viewing) goHome({ replace: true });
      return;
  }
}

function scheduleManualReconnect(delayMs: number): void {
  window.clearTimeout(manualReconnectTimer);
  manualReconnectTimer = window.setTimeout(() => {
    if (!socket.connected && getState().replaced === null) socket.connect();
  }, delayMs);
}

/** Attach every socket and page listener. Safe to call more than once. */
export function initConnection(): void {
  if (initialized) return;
  initialized = true;

  socket.on("connect", () => {
    connectionEpoch += 1;
    heldVersion = 0;
    resumeInFlight = null;
    window.clearTimeout(manualReconnectTimer);
    setState({ connection: "connected" });
    if (getState().replaced === null && getState().session) void resume();
  });

  socket.on("disconnect", (reason) => {
    connectionEpoch += 1;
    resumeInFlight = null;
    const { session, sessionStatus } = getState();
    setState({
      connection: "reconnecting",
      sessionStatus: session && sessionStatus === "active" ? "resuming" : sessionStatus,
    });
    // The server closed this socket on purpose (e.g. another tab took over): Socket.IO
    // won't reconnect by itself, so come back unless the session moved elsewhere.
    if (reason === "io server disconnect") scheduleManualReconnect(1000);
  });

  socket.on("connect_error", () => {
    setState({ connection: getState().connection === "connected" ? "reconnecting" : getState().connection });
    // A refusal from the server's middleware (e.g. RATE_LIMITED) stops automatic retries.
    if (!socket.active) scheduleManualReconnect(5000);
  });

  socket.on("game:state", onGameState);

  socket.on("chat:message", (message) => {
    if (!getState().session) return;
    const chat = getState().chat;
    if (chat.some((m) => m.id === message.id)) return;
    setState({ chat: [...chat.slice(-(MAX_CHAT_MESSAGES - 1)), message] });
  });

  socket.on("chat:history", (payload) => {
    if (!getState().session) return;
    setState({ chat: payload.messages.slice(-MAX_CHAT_MESSAGES) });
  });

  socket.on("room:removed", onRemoved);

  socket.on("session:replaced", (payload) => {
    window.clearTimeout(manualReconnectTimer);
    window.clearTimeout(resumeRetryTimer);
    setState({
      replaced: payload.message || "This game is open on another tab or device.",
      sessionStatus: getState().session ? "resuming" : "idle",
    });
  });

  socket.on("server:error", (payload) => {
    showToast(friendlyError(payload));
  });

  const wake = () => {
    if (document.visibilityState === "visible" && !socket.connected && getState().replaced === null) {
      socket.connect();
    }
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  window.addEventListener("pageshow", wake);
}
