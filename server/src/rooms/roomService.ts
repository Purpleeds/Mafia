import type {
  ChatChannel,
  ChatHistoryPayload,
  ChatMessage,
  ErrorCode,
  ErrorPayload,
  GameStatePayload,
  RemovedPayload,
  RemovedReason,
  SessionInfo,
} from "@mafia/shared";
import {
  applyAction,
  canRead,
  canWrite,
  createLobby,
  cryptoRng,
  getGameView,
  type GameAction,
  type GameState,
  type Rng,
} from "../game/index.js";
import type { Logger } from "../logger.js";
import { MAX_CHAT_HISTORY, canSeeInHistory, sanitizeChatText } from "./chatRules.js";
import { generateRoomCode, hashToken, newPlayerId, newSessionToken } from "./ids.js";
import { KeyedMutex } from "./keyedMutex.js";
import type { RoomStore } from "./roomStore.js";
import type { Scheduler } from "./scheduler.js";
import type { Room } from "./types.js";

/** How the service talks to players. The Socket.IO layer implements it; tests use a fake. */
export interface Broadcaster {
  state(roomCode: string, playerId: string, payload: GameStatePayload): void;
  chat(roomCode: string, playerId: string, message: ChatMessage): void;
  chatHistory(roomCode: string, playerId: string, payload: ChatHistoryPayload): void;
  /** Tell the player they're out of the room and stop sending them anything from it. */
  removed(roomCode: string, playerId: string, payload: RemovedPayload): void;
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ErrorPayload };

/** Actions a player may trigger (JOIN goes through joinRoom, TICK comes from the timer). */
export type PlayerAction = Exclude<GameAction, { type: "JOIN" } | { type: "TICK" }>;

export interface RoomServiceOptions {
  store: RoomStore;
  broadcaster: Broadcaster;
  scheduler: Scheduler;
  logger: Logger;
  clock?: () => number;
  rng?: Rng;
  generateCode?: () => string;
  maxRooms?: number;
  /** Close a room this long after its last player disconnected. */
  emptyRoomTtlMs?: number;
  /** Close a room nobody has touched for this long. */
  idleRoomTtlMs?: number;
  /** Remove a lobby player who has been disconnected this long. */
  lobbyDropMs?: number;
}

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = <T = never>(code: ErrorCode, message: string): ServiceResult<T> => ({
  ok: false,
  error: { code, message },
});

const REMOVED_MESSAGES: Record<RemovedReason, string> = {
  left: "You left the room.",
  dropped: "You were removed from the room because you were disconnected.",
  room_closed: "This room has closed.",
};

/**
 * Owns every room: applies actions to the pure engine, persists the result,
 * runs phase timers, and sends each player only their own view.
 *
 * All work on a room runs inside a per-room lock, so events for the same room
 * are handled strictly one after another.
 */
export class RoomService {
  private readonly store: RoomStore;
  private readonly broadcaster: Broadcaster;
  private readonly scheduler: Scheduler;
  private readonly logger: Logger;
  private readonly clock: () => number;
  private readonly rng: Rng;
  private readonly generateCode: () => string;
  private readonly maxRooms: number;
  private readonly emptyRoomTtlMs: number;
  private readonly idleRoomTtlMs: number;
  private readonly lobbyDropMs: number;
  private readonly mutex = new KeyedMutex();

  constructor(options: RoomServiceOptions) {
    this.store = options.store;
    this.broadcaster = options.broadcaster;
    this.scheduler = options.scheduler;
    this.logger = options.logger;
    this.clock = options.clock ?? Date.now;
    this.rng = options.rng ?? cryptoRng;
    this.generateCode = options.generateCode ?? generateRoomCode;
    this.maxRooms = options.maxRooms ?? 1000;
    this.emptyRoomTtlMs = options.emptyRoomTtlMs ?? 10 * 60_000;
    this.idleRoomTtlMs = options.idleRoomTtlMs ?? 3 * 60 * 60_000;
    this.lobbyDropMs = options.lobbyDropMs ?? 2 * 60_000;
  }

  // ------------------------------------------------------------ joining

  async createRoom(name: string): Promise<ServiceResult<SessionInfo>> {
    if ((await this.store.count()) >= this.maxRooms) {
      this.logger.warn("room.create_refused", { reason: "max_rooms", max: this.maxRooms });
      return fail("SERVER_BUSY", "The server is full right now. Please try again in a few minutes.");
    }
    const now = this.clock();
    const playerId = newPlayerId();
    const sessionToken = newSessionToken();
    const joined = applyAction(createLobby(), { type: "JOIN", playerId, name }, this.context());
    if (!joined.ok) return { ok: false, error: joined.error };

    for (let attempt = 0; attempt < 50; attempt++) {
      const code = this.generateCode();
      const room: Room = {
        code,
        state: joined.state,
        version: 1,
        sessions: { [hashToken(sessionToken)]: playerId },
        chat: [],
        nextMessageId: 1,
        createdAt: now,
        lastActivityAt: now,
        emptySince: null,
        disconnectedAt: {},
      };
      if (await this.store.create(room)) {
        this.logger.info("room.created", { room: code, player: playerId, rooms: await this.store.count() });
        return ok({ roomCode: code, playerId, sessionToken });
      }
    }
    this.logger.error("room.create_failed", { reason: "no_free_code" });
    return fail("SERVER_BUSY", "Couldn't find a free room code. Please try again.");
  }

  joinRoom(code: string, name: string): Promise<ServiceResult<SessionInfo>> {
    return this.withRoom(code, async (room) => {
      const playerId = newPlayerId();
      const sessionToken = newSessionToken();
      const prev = this.apply(room, { type: "JOIN", playerId, name });
      if (!prev.ok) return prev;
      room.sessions[hashToken(sessionToken)] = playerId;
      await this.commit(room, prev.value);
      this.logger.info("player.joined", { room: code, player: playerId, players: room.state.players.length });
      return ok({ roomCode: code, playerId, sessionToken });
    });
  }

  /** Finds the player a session token belongs to. Doesn't change anything. */
  resumeSession(code: string, sessionToken: string): Promise<ServiceResult<SessionInfo>> {
    return this.withRoom(code, async (room) => {
      const hashed = hashToken(sessionToken);
      const playerId = Object.hasOwn(room.sessions, hashed) ? room.sessions[hashed] : undefined;
      if (!playerId || !room.state.players.some((p) => p.id === playerId)) {
        return fail("SESSION_INVALID", "That session has expired. Please join again.");
      }
      return ok({ roomCode: code, playerId, sessionToken });
    });
  }

  /** Called by the connection layer when a player's connection comes or goes. */
  setConnected(code: string, playerId: string, connected: boolean): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      const player = room.state.players.find((p) => p.id === playerId);
      if (!player) return fail("NOT_IN_ROOM", "You are not in this room.");
      if (player.connected === connected) return ok(null);
      const prev = this.apply(room, { type: connected ? "RECONNECT" : "DISCONNECT", playerId });
      if (!prev.ok) return prev;
      if (connected) delete room.disconnectedAt[playerId];
      else room.disconnectedAt[playerId] = this.clock();
      await this.commit(room, prev.value);
      this.logger.info(connected ? "player.reconnected" : "player.disconnected", { room: code, player: playerId });
      return ok(null);
    });
  }

  leave(code: string, playerId: string): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      const prev = this.apply(room, { type: "LEAVE", playerId });
      if (!prev.ok) return prev;
      await this.commit(room, prev.value, { removedReason: "left" });
      this.logger.info("player.left", { room: code, player: playerId, phase: room.state.phase });
      return ok(null);
    });
  }

  // ------------------------------------------------------------ playing

  /** Applies a player's action. The engine checks phase, life, role and target. */
  act(code: string, action: PlayerAction): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      const prev = this.apply(room, action);
      if (!prev.ok) return prev;
      await this.commit(room, prev.value);
      return ok(null);
    });
  }

  sendChat(code: string, playerId: string, channel: ChatChannel, rawText: string): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      const { state } = room;
      const sender = state.players.find((p) => p.id === playerId);
      if (!sender) return fail("NOT_IN_ROOM", "You are not in this room.");
      if (!canWrite(state, playerId, channel)) {
        return fail("CHAT_NOT_ALLOWED", "You can't send messages there right now.");
      }
      const text = sanitizeChatText(rawText);
      if (text === null) return fail("BAD_REQUEST", "Messages must be 1–300 characters.");

      const message: ChatMessage = {
        id: String(room.nextMessageId++),
        channel,
        senderId: sender.id,
        senderName: sender.name,
        text,
        sentAt: this.clock(),
      };
      room.chat.push(message);
      if (room.chat.length > MAX_CHAT_HISTORY) room.chat.splice(0, room.chat.length - MAX_CHAT_HISTORY);
      room.lastActivityAt = message.sentAt;
      await this.store.save(room);

      for (const p of state.players) {
        if (canRead(state, p.id, channel)) this.broadcaster.chat(code, p.id, message);
      }
      return ok(null);
    });
  }

  /** Sends one player their current view and the chat history they're allowed to see. */
  sendSnapshot(code: string, playerId: string): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      if (!room.state.players.some((p) => p.id === playerId)) return fail("NOT_IN_ROOM", "You are not in this room.");
      this.broadcaster.state(code, playerId, this.statePayload(room, playerId, this.clock()));
      this.broadcaster.chatHistory(code, playerId, {
        messages: room.chat.filter((m) => canSeeInHistory(room.state, playerId, m)),
      });
      return ok(null);
    });
  }

  /** The phase timer fired. */
  async handleTimer(code: string): Promise<void> {
    try {
      await this.withRoom(code, async (room) => {
        const prev = this.apply(room, { type: "TICK" });
        if (!prev.ok) return prev;
        const before = prev.value;
        if (before.phase === room.state.phase && before.phaseEndsAt === room.state.phaseEndsAt) {
          // Fired a little early: nothing changed, so just wait for the real deadline.
          this.scheduleTimer(room);
          return ok(null);
        }
        await this.commit(room, before, { activity: false });
        return ok(null);
      });
    } catch (err) {
      this.logger.error("timer.failed", { room: code }, err);
    }
  }

  // ------------------------------------------------------------ housekeeping

  /** Closes abandoned rooms and removes long-disconnected lobby players. Run every minute or so. */
  async sweep(): Promise<void> {
    for (const code of await this.store.codes()) {
      try {
        await this.withRoom(code, async (room) => {
          const now = this.clock();
          if (room.emptySince !== null && now - room.emptySince >= this.emptyRoomTtlMs) {
            await this.close(room, "empty");
            return ok(null);
          }
          if (now - room.lastActivityAt >= this.idleRoomTtlMs) {
            await this.close(room, "idle");
            return ok(null);
          }
          if (room.state.phase === "LOBBY") {
            const stale = room.state.players.filter((p) => {
              const since = room.disconnectedAt[p.id];
              return !p.connected && since !== undefined && now - since >= this.lobbyDropMs;
            });
            if (stale.length > 0) {
              const before = room.state;
              for (const p of stale) {
                const r = applyAction(room.state, { type: "LEAVE", playerId: p.id }, this.context());
                if (r.ok) room.state = r.state;
              }
              await this.commit(room, before, { activity: false, removedReason: "dropped" });
              this.logger.info("lobby.dropped_players", { room: code, count: stale.length });
            }
          }
          return ok(null);
        });
      } catch (err) {
        this.logger.error("sweep.failed", { room: code }, err);
      }
    }
  }

  async roomCount(): Promise<number> {
    return this.store.count();
  }

  // ------------------------------------------------------------ internals

  private context() {
    return { now: this.clock(), rng: this.rng };
  }

  private async withRoom<T>(code: string, task: (room: Room) => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
    return this.mutex.run(code, async () => {
      const room = await this.store.get(code);
      if (!room) return fail("ROOM_NOT_FOUND", "That room doesn't exist. Check the code and try again.");
      return task(room);
    });
  }

  /** Runs an action through the engine. On success room.state is replaced and the old state returned. */
  private apply(room: Room, action: GameAction): ServiceResult<GameState> {
    const result = applyAction(room.state, action, this.context());
    if (!result.ok) return { ok: false, error: result.error };
    const prev = room.state;
    room.state = result.state;
    return ok(prev);
  }

  /** Saves a changed room, then re-arms its timer and sends every player their new view. */
  private async commit(
    room: Room,
    prev: GameState,
    opts: { activity?: boolean; removedReason?: RemovedReason } = {},
  ): Promise<void> {
    const now = this.clock();
    const { state } = room;
    room.version += 1;
    if (opts.activity !== false) room.lastActivityAt = now;

    const remaining = new Set(state.players.map((p) => p.id));
    const removed = prev.players.filter((p) => !remaining.has(p.id)).map((p) => p.id);
    for (const playerId of removed) {
      for (const [hash, owner] of Object.entries(room.sessions)) if (owner === playerId) delete room.sessions[hash];
      delete room.disconnectedAt[playerId];
    }

    if (prev.phase !== state.phase) {
      // A new game (or the lobby after one) starts with fresh private channels.
      if (state.phase === "ROLE_REVEAL" || state.phase === "LOBBY") {
        room.chat = room.chat.filter((m) => m.channel === "public");
      }
      this.logPhaseChange(room, prev);
    }

    const connected = state.players.filter((p) => p.connected).length;
    room.emptySince = connected > 0 ? null : (room.emptySince ?? now);

    if (state.players.length === 0) {
      await this.close(room, "empty", removed);
      return;
    }

    await this.store.save(room);
    this.scheduleTimer(room);

    const reason = opts.removedReason ?? "dropped";
    for (const playerId of removed) {
      this.broadcaster.removed(room.code, playerId, { reason, message: REMOVED_MESSAGES[reason] });
    }
    for (const p of state.players) this.broadcaster.state(room.code, p.id, this.statePayload(room, p.id, now));
  }

  private scheduleTimer(room: Room): void {
    const { phaseEndsAt } = room.state;
    if (phaseEndsAt === null) this.scheduler.clear(room.code);
    else this.scheduler.set(room.code, phaseEndsAt, () => void this.handleTimer(room.code));
  }

  private statePayload(room: Room, playerId: string, now: number): GameStatePayload {
    return { version: room.version, serverNow: now, view: getGameView(room.state, playerId) };
  }

  private async close(room: Room, reason: "empty" | "idle", alsoNotify: string[] = []): Promise<void> {
    this.scheduler.clear(room.code);
    await this.store.delete(room.code);
    const payload: RemovedPayload = { reason: "room_closed", message: REMOVED_MESSAGES.room_closed };
    for (const playerId of new Set([...room.state.players.map((p) => p.id), ...alsoNotify])) {
      this.broadcaster.removed(room.code, playerId, payload);
    }
    this.logger.info("room.closed", { room: room.code, reason, rooms: await this.store.count() });
  }

  private logPhaseChange(room: Room, prev: GameState): void {
    const { state, code } = room;
    if (prev.phase === "LOBBY" && state.phase === "ROLE_REVEAL") {
      const extras = Object.entries(state.settings.optionalRoles)
        .filter(([, on]) => on)
        .map(([role]) => role);
      this.logger.info("game.started", {
        room: code,
        players: state.players.length,
        mafia: state.mafiaCount,
        extraRoles: extras.join(",") || "none",
        mode: state.settings.contentMode,
        tieRule: state.settings.tieRule,
        revealRoles: state.settings.revealRoleOnDeath,
      });
      return;
    }
    if (state.phase === "LOBBY") {
      this.logger.info("game.restarted", { room: code, players: state.players.length });
      return;
    }
    if (state.phase === "GAME_OVER") {
      this.logger.info("game.over", { room: code, winner: state.winner, rounds: state.round });
      return;
    }
    this.logger.info("phase.changed", {
      room: code,
      phase: state.phase,
      round: state.round,
      outcome: state.phase === "VOTE_RESULTS" ? state.voteReport?.outcome : undefined,
      deaths:
        state.phase === "NIGHT_RESULTS"
          ? (state.nightReport?.deaths.length ?? 0)
          : state.phase === "VOTE_RESULTS"
            ? (state.voteReport?.deaths.length ?? 0)
            : undefined,
    });
  }
}
