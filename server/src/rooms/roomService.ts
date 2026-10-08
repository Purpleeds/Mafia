import { randomUUID } from "node:crypto";
import {
  MAX_PLAYERS,
  MAX_SPECTATORS,
  NARRATION_TIMEOUT_MS,
  censorProfanity,
  containsProfanity,
  isChatFiltered,
  validateCustomRoomCode,
  validateRoomPassword,
  type Avatar,
  CHAT_REACTIONS,
  MAX_CHAT_LENGTH,
  type ChatReaction,
  type ChatHistoryPayload,
  type ChatMessage,
  type ErrorCode,
  type ErrorPayload,
  type GameStatePayload,
  type GameView,
  type NarratorRequestPayload,
  type RemovedPayload,
  type RemovedReason,
  type RoomInfo,
  type RoomPreview,
  type SessionInfo,
} from "@mafia/shared";
import {
  applyAction,
  canRead,
  chatChannelFor,
  createLobby,
  cryptoRng,
  getGameView,
  nextWake,
  type GameAction,
  type GameState,
  type NarrationFallback,
  type Rng,
} from "../game/index.js";
import type { Logger } from "../logger.js";
import { narrationFacts } from "../narration/facts.js";
import { MAX_CHAT_HISTORY, canSeeInHistory, sanitizeChatText } from "./chatRules.js";
import { digest, generateRoomCode, hashToken, newPlayerId, newSessionToken } from "./ids.js";
import { KeyedMutex } from "./keyedMutex.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import type { RoomStore } from "./roomStore.js";
import type { Scheduler } from "./scheduler.js";
import type { Room } from "./types.js";

/** How the service talks to players. The Socket.IO layer implements it; tests use a fake. */
export interface Broadcaster {
  state(roomCode: string, playerId: string, payload: GameStatePayload): void;
  chat(roomCode: string, playerId: string, message: ChatMessage): void;
  chatHistory(roomCode: string, playerId: string, payload: ChatHistoryPayload): void;
  /** Tell the member they're out of the room and stop sending them anything from it. */
  removed(roomCode: string, playerId: string, payload: RemovedPayload): void;
  /** Ask the host's browser to write a narration. Only ever sent to the host. */
  narrationRequest(roomCode: string, playerId: string, payload: NarratorRequestPayload): void;
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ErrorPayload };

/**
 * Actions a member may trigger (JOIN goes through joinRoom, TICK comes from the
 * timer, NARRATE only through submitNarration, which checks it is the host's answer).
 */
export type PlayerAction = Exclude<GameAction, { type: "JOIN" } | { type: "TICK" } | { type: "NARRATE" }>;

export interface CreateRoomOptions {
  customCode?: string;
  password?: string;
  /** Identifies the creator (a hash of their IP); limits how many rooms one creator keeps open. */
  ownerKey?: string;
}

export interface RoomServiceOptions {
  store: RoomStore;
  broadcaster: Broadcaster;
  scheduler: Scheduler;
  logger: Logger;
  clock?: () => number;
  rng?: Rng;
  generateCode?: () => string;
  maxRooms?: number;
  /** Rooms one creator (ownerKey) may have open at once. */
  maxRoomsPerOwner?: number;
  /** Close a room this long after its last member disconnected. */
  emptyRoomTtlMs?: number;
  /** Close a room nobody has touched for this long. */
  idleRoomTtlMs?: number;
  /** Same, for a room still in its lobby. */
  idleLobbyTtlMs?: number;
  /** Remove a lobby player (or any spectator) who has been disconnected this long. */
  lobbyDropMs?: number;
}

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = <T = never>(code: ErrorCode, message: string): ServiceResult<T> => ({
  ok: false,
  error: { code, message },
});

const REMOVED_MESSAGES: Record<RemovedReason, string> = {
  left: "You left the room.",
  kicked: "The host removed you from the room.",
  dropped: "You were removed from the room because you were away too long.",
  room_closed: "This room has closed.",
};

/** Game-rule rejections that would hint at someone's role if logged next to their id. */
const QUIET_REJECTIONS = new Set<ErrorCode>(["NO_ABILITY", "INVALID_TARGET", "REPEAT_PROTECTION", "DEAD_PLAYER"]);

function memberIds(state: GameState): string[] {
  return [...state.players.map((p) => p.id), ...state.spectators.map((p) => p.id)];
}

function findMember(state: GameState, id: string) {
  return state.players.find((p) => p.id === id) ?? state.spectators.find((p) => p.id === id);
}

/**
 * Owns every room: applies actions to the pure engine, persists the result,
 * runs phase timers, and sends each member only their own view.
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
  private readonly maxRoomsPerOwner: number;
  private readonly emptyRoomTtlMs: number;
  private readonly idleRoomTtlMs: number;
  private readonly idleLobbyTtlMs: number;
  private readonly lobbyDropMs: number;
  private readonly mutex = new KeyedMutex();
  /** ownerKey -> codes of their open rooms (rebuilt by recover()). */
  private readonly roomsByOwner = new Map<string, Set<string>>();
  /** room code -> id of the narration the host's browser has been asked to write. */
  private readonly narrationAsked = new Map<string, string>();

  constructor(options: RoomServiceOptions) {
    this.store = options.store;
    this.broadcaster = options.broadcaster;
    this.scheduler = options.scheduler;
    this.logger = options.logger;
    this.clock = options.clock ?? Date.now;
    this.rng = options.rng ?? cryptoRng;
    this.generateCode = options.generateCode ?? generateRoomCode;
    this.maxRooms = options.maxRooms ?? 1000;
    this.maxRoomsPerOwner = options.maxRoomsPerOwner ?? 5;
    this.emptyRoomTtlMs = options.emptyRoomTtlMs ?? 10 * 60_000;
    this.idleRoomTtlMs = options.idleRoomTtlMs ?? 3 * 60 * 60_000;
    this.idleLobbyTtlMs = options.idleLobbyTtlMs ?? 30 * 60_000;
    this.lobbyDropMs = options.lobbyDropMs ?? 2 * 60_000;
  }

  // ------------------------------------------------------------ joining

  async createRoom(name: string, avatar: Avatar, options: CreateRoomOptions = {}): Promise<ServiceResult<SessionInfo>> {
    if ((await this.store.count()) >= this.maxRooms) {
      this.logger.warn("room.create_refused", { reason: "max_rooms", max: this.maxRooms });
      return fail("SERVER_BUSY", "The server is full right now. Please try again in a few minutes.");
    }
    const owner = options.ownerKey ?? null;
    if (owner !== null && (this.roomsByOwner.get(owner)?.size ?? 0) >= this.maxRoomsPerOwner) {
      this.logger.warn("room.create_refused", { reason: "owner_limit", max: this.maxRoomsPerOwner });
      return fail("SERVER_BUSY", "You already have several rooms open. Close one before making another.");
    }

    let customCode: string | null = null;
    if (options.customCode !== undefined && options.customCode.trim() !== "") {
      const checked = validateCustomRoomCode(options.customCode);
      if (!checked.ok) return fail("CODE_INVALID", checked.reason);
      customCode = checked.value;
    }

    let passwordHash: string | null = null;
    if (options.password !== undefined && options.password !== "") {
      const checked = validateRoomPassword(options.password);
      if (!checked.ok) return fail("BAD_REQUEST", checked.reason);
      passwordHash = await hashPassword(checked.value);
    }

    const now = this.clock();
    const playerId = newPlayerId();
    const sessionToken = newSessionToken();
    const joined = applyAction(createLobby(), { type: "JOIN", playerId, name, avatar }, this.context());
    if (!joined.ok) return { ok: false, error: joined.error };

    const makeRoom = (code: string): Room => ({
      code,
      state: joined.state,
      passwordHash,
      ownerKey: owner,
      sessions: { [hashToken(sessionToken)]: playerId },
      chat: [],
      createdAt: now,
      lastActivityAt: now,
      emptySince: null,
      disconnectedAt: {},
      reconnecting: {},
      delivery: {},
    });
    const created = (code: string): ServiceResult<SessionInfo> => {
      if (owner !== null) this.indexOwner(owner, code);
      this.logger.info("room.created", {
        room: code,
        player: playerId,
        customCode: customCode !== null,
        private: passwordHash !== null,
      });
      return ok({ roomCode: code, playerId, sessionToken, seat: "player" });
    };

    if (customCode !== null) {
      if (!(await this.store.create(makeRoom(customCode)))) {
        return fail("CODE_TAKEN", "That room code is already in use. Try another.");
      }
      return created(customCode);
    }

    for (let attempt = 0; attempt < 50; attempt++) {
      const code = this.generateCode();
      if (containsProfanity(code)) continue;
      if (await this.store.create(makeRoom(code))) return created(code);
    }
    this.logger.error("room.create_failed", { reason: "no_free_code" });
    return fail("SERVER_BUSY", "Couldn't find a free room code. Please try again.");
  }

  /** What the join screen needs before asking for a name. Changes nothing. */
  peek(code: string): Promise<ServiceResult<RoomPreview>> {
    return this.withRoom(code, async (room) => {
      const { state } = room;
      const stage = state.phase === "LOBBY" ? "lobby" : state.phase === "GAME_OVER" ? "game_over" : "in_game";
      const joinAs = stage === "lobby" ? "player" : "spectator";
      return ok({
        roomCode: code,
        hasPassword: room.passwordHash !== null,
        stage,
        playerCount: state.players.length,
        maxPlayers: MAX_PLAYERS,
        joinAs,
        isFull: joinAs === "player" ? state.players.length >= MAX_PLAYERS : state.spectators.length >= MAX_SPECTATORS,
      });
    });
  }

  /** Joins as a player in the lobby, or as a spectator once a game has started. */
  joinRoom(code: string, name: string, avatar: Avatar, password?: string): Promise<ServiceResult<SessionInfo>> {
    return this.withRoom(code, async (room) => {
      if (room.passwordHash !== null) {
        if (!password) return fail("PASSWORD_REQUIRED", "This room is private. Enter its password to join.");
        if (!(await verifyPassword(password, room.passwordHash))) {
          this.logger.warn("room.wrong_password", { room: code });
          return fail("WRONG_PASSWORD", "That password isn't right.");
        }
      }
      const playerId = newPlayerId();
      const sessionToken = newSessionToken();
      const prev = this.apply(room, { type: "JOIN", playerId, name, avatar });
      if (!prev.ok) return prev;
      room.sessions[hashToken(sessionToken)] = playerId;
      await this.commit(room, prev.value);
      const seat = room.state.players.some((p) => p.id === playerId) ? "player" : "spectator";
      this.logger.info("player.joined", { room: code, player: playerId, seat, players: room.state.players.length });
      return ok({ roomCode: code, playerId, sessionToken, seat });
    });
  }

  /** Finds the member a session token belongs to. Doesn't change anything. */
  resumeSession(code: string, sessionToken: string): Promise<ServiceResult<SessionInfo>> {
    return this.withRoom(code, async (room) => {
      const hashed = hashToken(sessionToken);
      const memberId = Object.hasOwn(room.sessions, hashed) ? room.sessions[hashed] : undefined;
      const member = memberId === undefined ? undefined : findMember(room.state, memberId);
      if (!memberId || !member || ("kicked" in member && member.kicked)) {
        return fail("SESSION_INVALID", "That session has expired. Please join again.");
      }
      const seat = room.state.players.some((p) => p.id === memberId) ? "player" : "spectator";
      return ok({ roomCode: code, playerId: memberId, sessionToken, seat });
    });
  }

  /**
   * A member's connection dropped. They stay present for the grace period
   * (shown as "reconnecting") before setConnected(false) marks them gone.
   */
  markReconnecting(code: string, memberId: string): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      const member = findMember(room.state, memberId);
      if (!member) return fail("NOT_IN_ROOM", "You are not in this room.");
      if (!member.connected || room.reconnecting[memberId] !== undefined) return ok(null);
      room.reconnecting[memberId] = this.clock();
      await this.publish(room);
      return ok(null);
    });
  }

  /** Called by the connection layer when a member is back, or gone for good (after the grace period). */
  setConnected(code: string, memberId: string, connected: boolean): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      const member = findMember(room.state, memberId);
      if (!member) return fail("NOT_IN_ROOM", "You are not in this room.");
      const wasReconnecting = room.reconnecting[memberId] !== undefined;
      delete room.reconnecting[memberId];
      if (member.connected === connected) {
        if (wasReconnecting) await this.publish(room);
        return ok(null);
      }
      const prev = this.apply(room, { type: connected ? "RECONNECT" : "DISCONNECT", playerId: memberId });
      if (!prev.ok) return prev;
      if (connected) delete room.disconnectedAt[memberId];
      else room.disconnectedAt[memberId] = this.clock();
      await this.commit(room, prev.value, { activity: connected });
      this.logger.info(connected ? "player.reconnected" : "player.disconnected", { room: code, player: memberId });
      return ok(null);
    });
  }

  leave(code: string, memberId: string): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      const prev = this.apply(room, { type: "LEAVE", playerId: memberId });
      if (!prev.ok) return prev;
      delete room.reconnecting[memberId];
      await this.commit(room, prev.value, { removedReason: "left" });
      this.logger.info("player.left", { room: code, player: memberId, phase: room.state.phase });
      return ok(null);
    });
  }

  /** Host only: set (or with null, remove) the room password. */
  setPassword(code: string, memberId: string, password: string | null): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      if (room.state.hostId !== memberId) return fail("NOT_HOST", "Only the host can change the password.");
      if (password === null || password === "") {
        room.passwordHash = null;
      } else {
        const checked = validateRoomPassword(password);
        if (!checked.ok) return fail("BAD_REQUEST", checked.reason);
        room.passwordHash = await hashPassword(checked.value);
      }
      room.lastActivityAt = this.clock();
      await this.publish(room);
      this.logger.info("room.password_changed", { room: code, private: room.passwordHash !== null });
      return ok(null);
    });
  }

  // ------------------------------------------------------------ playing

  /** Applies a member's action. The engine checks phase, host, life, role and target. */
  act(code: string, action: PlayerAction): Promise<ServiceResult<null>> {
    // The types already exclude these; checking at run time too means no caller can force a timer tick,
    // a join, or a narration through here.
    const type: string = action.type;
    if (type === "NARRATE" || type === "TICK" || type === "JOIN") {
      return Promise.resolve(fail("BAD_REQUEST", "That isn't something a player can do."));
    }
    return this.withRoom(code, async (room) => {
      const prev = this.apply(room, action);
      if (!prev.ok) return prev;
      await this.commit(room, prev.value, action.type === "KICK" ? { removedReason: "kicked" } : {});
      if (action.type === "KICK") this.logger.info("player.kicked", { room: code, player: action.targetId });
      if (action.type === "TRANSFER_HOST") this.logger.info("host.transferred", { room: code, to: action.targetId });
      return ok(null);
    });
  }

  /** A typed message. The server picks the channel from who the sender is. */
  sendChat(code: string, memberId: string, rawText: string): Promise<ServiceResult<null>> {
    return this.relayChat(code, memberId, (state) => {
      const cleaned = sanitizeChatText(rawText);
      if (cleaned === null) return fail("BAD_REQUEST", `Messages must be 1–${MAX_CHAT_LENGTH} characters.`);
      // Safe Mode always masks rude words; in Normal Mode it is the host's choice.
      return ok({ text: isChatFiltered(state.settings) ? censorProfanity(cleaned) : cleaned });
    });
  }

  /** A quick reaction, routed exactly like typed text. */
  sendReaction(code: string, memberId: string, reaction: ChatReaction): Promise<ServiceResult<null>> {
    if (!(CHAT_REACTIONS as readonly string[]).includes(reaction)) {
      return Promise.resolve(fail("BAD_REQUEST", "Unknown reaction."));
    }
    return this.relayChat(code, memberId, () => ok({ text: "", reaction }));
  }

  private relayChat(
    code: string,
    memberId: string,
    build: (state: GameState) => ServiceResult<{ text: string; reaction?: ChatReaction }>,
  ): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      const { state } = room;
      const sender = findMember(state, memberId);
      if (!sender) return fail("NOT_IN_ROOM", "You are not in this room.");
      const channel = chatChannelFor(state, memberId);
      if (channel === null) return fail("CHAT_NOT_ALLOWED", "You can't send messages right now.");
      const content = build(state);
      if (!content.ok) return content;

      const message: ChatMessage = {
        // Random ids: a shared counter would reveal how much hidden-channel chat happened.
        id: randomUUID(),
        channel,
        senderId: sender.id,
        senderName: sender.name,
        text: content.value.text,
        ...(content.value.reaction ? { reaction: content.value.reaction } : {}),
        sentAt: this.clock(),
      };
      room.chat.push(message);
      if (room.chat.length > MAX_CHAT_HISTORY) room.chat.splice(0, room.chat.length - MAX_CHAT_HISTORY);
      room.lastActivityAt = message.sentAt;
      await this.store.save(room);

      for (const id of memberIds(state)) {
        if (canRead(state, id, channel)) this.broadcaster.chat(code, id, message);
      }
      return ok(null);
    });
  }

  /** Sends one member their current view and the chat history they're allowed to see. */
  sendSnapshot(code: string, memberId: string): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      if (!findMember(room.state, memberId)) return fail("NOT_IN_ROOM", "You are not in this room.");
      const now = this.clock();
      const payload = this.prepareDelivery(room, memberId, now, true);
      await this.store.save(room);
      if (payload) this.broadcaster.state(code, memberId, payload);
      this.broadcaster.chatHistory(code, memberId, {
        messages: room.chat.filter((m) => canSeeInHistory(room.state, memberId, m)),
      });
      return ok(null);
    });
  }

  /**
   * The host's browser answered a narrator:request. Only the host's answer to the
   * announcement that is waiting counts; anything else (a late answer after the
   * fallback, an old request) is ignored. The engine checks the text itself.
   */
  submitNarration(code: string, memberId: string, requestId: string, text: string | null): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      if (room.state.hostId !== memberId) return fail("NOT_HOST", "Only the host can write the narration.");
      const narration = room.state.narration;
      if (!narration || narration.status !== "pending" || narration.id !== requestId) return ok(null);
      await this.finishNarration(room, text, text === null ? "ai_failed" : undefined);
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
        if (
          before.phase === room.state.phase &&
          before.phaseEndsAt === room.state.phaseEndsAt &&
          before.narration?.status === room.state.narration?.status
        ) {
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

  /**
   * Closes rooms that have been empty for 10 minutes (or untouched for hours)
   * and removes members who stayed away. Run every minute or so.
   */
  async sweep(): Promise<void> {
    for (const code of await this.store.codes()) {
      try {
        await this.withRoom(code, async (room) => {
          const now = this.clock();
          if (room.emptySince !== null && now - room.emptySince >= this.emptyRoomTtlMs) {
            await this.close(room, "empty");
            return ok(null);
          }
          const idleLimit = room.state.phase === "LOBBY" ? this.idleLobbyTtlMs : this.idleRoomTtlMs;
          if (now - room.lastActivityAt >= idleLimit) {
            await this.close(room, "idle");
            return ok(null);
          }
          const awayTooLong = (id: string, connected: boolean) => {
            const since = room.disconnectedAt[id];
            return !connected && since !== undefined && now - since >= this.lobbyDropMs;
          };
          const stale = [
            ...(room.state.phase === "LOBBY" ? room.state.players : []),
            ...room.state.spectators,
          ].filter((m) => awayTooLong(m.id, m.connected));
          if (stale.length > 0) {
            const before = room.state;
            for (const m of stale) {
              const r = applyAction(room.state, { type: "LEAVE", playerId: m.id }, this.context());
              if (r.ok) room.state = r.state;
            }
            await this.commit(room, before, { activity: false, removedReason: "dropped" });
            this.logger.info("room.dropped_absent", { room: code, count: stale.length });
          }
          return ok(null);
        });
      } catch (err) {
        this.logger.error("sweep.failed", { room: code }, err);
      }
    }
  }

  /**
   * After a server restart with a persistent store: no connections survived, so
   * mark everyone disconnected and re-arm the phase timers. (A no-op for the
   * in-memory store, which starts empty.)
   */
  async recover(): Promise<void> {
    const codes = await this.store.codes();
    for (const code of codes) {
      await this.withRoom(code, async (room) => {
        const now = this.clock();
        for (const id of memberIds(room.state)) {
          const member = findMember(room.state, id);
          if (!member?.connected) continue;
          const r = applyAction(room.state, { type: "DISCONNECT", playerId: id }, this.context());
          if (r.ok) {
            room.state = r.state;
            room.disconnectedAt[id] = now;
          }
        }
        room.reconnecting = {};
        room.emptySince = room.emptySince ?? now;
        if (room.ownerKey) this.indexOwner(room.ownerKey, room.code);
        await this.store.save(room);
        this.scheduleTimer(room);
        return ok(null);
      });
    }
    if (codes.length > 0) this.logger.info("rooms.recovered", { rooms: codes.length });
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
    if (!result.ok) {
      if (!QUIET_REJECTIONS.has(result.error.code)) {
        // Never next to a member id for role-revealing codes (see QUIET_REJECTIONS).
        this.logger.warn("action.rejected", { room: room.code, action: action.type, code: result.error.code });
      }
      return { ok: false, error: result.error };
    }
    const prev = room.state;
    room.state = result.state;
    return ok(prev);
  }

  /** Saves a changed room, re-arms its timer, tells removed members, and sends everyone whose view changed. */
  private async commit(
    room: Room,
    prev: GameState,
    opts: { activity?: boolean; removedReason?: RemovedReason } = {},
  ): Promise<void> {
    const now = this.clock();
    const { state } = room;
    if (opts.activity !== false) room.lastActivityAt = now;

    const remaining = new Set(memberIds(state));
    const gone = memberIds(prev).filter((id) => !remaining.has(id));
    const newlyKicked = state.players
      .filter((p) => p.kicked && !prev.players.some((q) => q.id === p.id && q.kicked))
      .map((p) => p.id);
    for (const id of [...gone, ...newlyKicked]) this.forgetMember(room, id);

    if (prev.phase !== state.phase) {
      // A new game (or the lobby after one) starts with fresh private channels.
      if (state.phase === "ROLE_REVEAL" || state.phase === "LOBBY") {
        room.chat = room.chat.filter((m) => m.channel === "public");
      }
      this.logPhaseChange(room, prev);
    }

    const connected = [...state.players.filter((p) => !p.kicked), ...state.spectators].filter((m) => m.connected).length;
    room.emptySince = connected > 0 ? null : (room.emptySince ?? now);

    if (remaining.size === 0) {
      await this.close(room, "empty", gone);
      return;
    }

    const outgoing = this.prepareDeliveries(room, now);
    await this.store.save(room);
    this.scheduleTimer(room);

    const reason = opts.removedReason ?? "dropped";
    for (const id of gone) this.broadcaster.removed(room.code, id, { reason, message: REMOVED_MESSAGES[reason] });
    for (const id of newlyKicked) {
      this.broadcaster.removed(room.code, id, { reason: "kicked", message: REMOVED_MESSAGES.kicked });
    }
    for (const [id, payload] of outgoing) this.broadcaster.state(room.code, id, payload);

    // A result was just announced: ask the host's browser for the narration (or settle for a ready-made line).
    await this.requestNarration(room);

    // Someone just eliminated can now read the graveyard: give them its history (and drop Mafia chat).
    for (const p of state.players) {
      const wasAlive = prev.players.some((q) => q.id === p.id && q.alive);
      if (wasAlive && !p.alive && !p.kicked) {
        this.broadcaster.chatHistory(room.code, p.id, {
          messages: room.chat.filter((m) => canSeeInHistory(state, p.id, m)),
        });
      }
    }
  }

  private indexOwner(owner: string, code: string): void {
    const codes = this.roomsByOwner.get(owner) ?? new Set<string>();
    codes.add(code);
    this.roomsByOwner.set(owner, codes);
  }

  /** Saves and sends without an engine change (password, reconnecting status). */
  private async publish(room: Room): Promise<void> {
    const outgoing = this.prepareDeliveries(room, this.clock());
    await this.store.save(room);
    for (const [id, payload] of outgoing) this.broadcaster.state(room.code, id, payload);
  }

  private forgetMember(room: Room, id: string): void {
    for (const [hash, owner] of Object.entries(room.sessions)) if (owner === id) delete room.sessions[hash];
    delete room.disconnectedAt[id];
    delete room.reconnecting[id];
    delete room.delivery[id];
  }

  /** Builds updates for every member whose view changed since their last one. */
  private prepareDeliveries(room: Room, now: number): Array<[string, GameStatePayload]> {
    const out: Array<[string, GameStatePayload]> = [];
    const kicked = new Set(room.state.players.filter((p) => p.kicked).map((p) => p.id));
    for (const id of memberIds(room.state)) {
      if (kicked.has(id)) continue;
      const payload = this.prepareDelivery(room, id, now, false);
      if (payload) out.push([id, payload]);
    }
    return out;
  }

  private prepareDelivery(room: Room, memberId: string, now: number, force: boolean): GameStatePayload | null {
    const info: RoomInfo = { code: room.code, hasPassword: room.passwordHash !== null };
    const view = this.viewFor(room, memberId);
    const hash = digest(JSON.stringify([info, view]));
    const last = room.delivery[memberId];
    if (!force && last?.hash === hash) return null;
    const version = (last?.version ?? 0) + 1;
    room.delivery[memberId] = { version, hash };
    return { version, serverNow: now, room: info, view };
  }

  /** The engine's view plus who is in their reconnect grace period. */
  private viewFor(room: Room, memberId: string): GameView {
    const view = getGameView(room.state, memberId);
    for (const m of [...view.players, ...view.spectators]) {
      if (m.connected && room.reconnecting[m.id] !== undefined) m.connection = "reconnecting";
    }
    return view;
  }

  private scheduleTimer(room: Room): void {
    const wake = nextWake(room.state);
    if (wake === null) this.scheduler.clear(room.code);
    else this.scheduler.set(room.code, wake, () => void this.handleTimer(room.code));
  }

  /**
   * When an announcement is waiting for the narrator, sends the host's browser
   * the public facts to write it from. With no host connected there is nobody to
   * ask, so a ready-made line is used straight away.
   */
  private async requestNarration(room: Room): Promise<void> {
    const { state } = room;
    const narration = state.narration;
    if (!narration || narration.status !== "pending") return;
    if (this.narrationAsked.get(room.code) === narration.id) return;
    this.narrationAsked.set(room.code, narration.id);

    const host = state.hostId === null ? undefined : state.players.find((p) => p.id === state.hostId);
    const facts = narrationFacts(state);
    if (!host || !host.connected || !facts) {
      await this.finishNarration(room, null, "host_away");
      return;
    }
    this.broadcaster.narrationRequest(room.code, host.id, {
      requestId: narration.id,
      facts,
      timeoutMs: NARRATION_TIMEOUT_MS,
    });
    this.logger.info("narration.requested", { room: room.code, kind: narration.kind, round: narration.round, mode: facts.mode });
  }

  /** Settles the waiting narration with the AI's text (or a ready-made line) and tells everyone. */
  private async finishNarration(room: Room, candidate: string | null, reason?: NarrationFallback): Promise<void> {
    const prev = this.apply(room, { type: "NARRATE", candidate, reason });
    if (!prev.ok) return;
    await this.commit(room, prev.value, { activity: false });
    const narration = room.state.narration;
    if (narration?.status === "ready") {
      this.logger.info("narration.ready", {
        room: room.code,
        kind: narration.kind,
        round: narration.round,
        source: narration.source,
        fallback: narration.fallback ?? undefined,
      });
    }
  }

  private async close(room: Room, reason: "empty" | "idle", alsoNotify: string[] = []): Promise<void> {
    this.scheduler.clear(room.code);
    this.narrationAsked.delete(room.code);
    if (room.ownerKey) {
      const codes = this.roomsByOwner.get(room.ownerKey);
      codes?.delete(room.code);
      if (codes?.size === 0) this.roomsByOwner.delete(room.ownerKey);
    }
    await this.store.delete(room.code);
    const payload: RemovedPayload = { reason: "room_closed", message: REMOVED_MESSAGES.room_closed };
    for (const id of new Set([...memberIds(room.state), ...alsoNotify])) this.broadcaster.removed(room.code, id, payload);
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
        spectators: state.spectators.length,
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
