import { randomUUID } from "node:crypto";
import {
  MAX_BOTS,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  MIN_PLAYERS,
  nicknameKey,
  validateNickname,
  type BotCountResult,
  NARRATION_TIMEOUT_MS,
  containsLink,
  containsProfanity,
  effectiveChatFilter,
  filterChatText,
  validateCustomRoomCode,
  validateRoomPassword,
  type Avatar,
  type AvatarImagesPayload,
  CHAT_REACTIONS,
  MAX_CHAT_LENGTH,
  type ChatReaction,
  type ChatHistoryPayload,
  type ChatMessage,
  type CheckSeatResult,
  type ErrorCode,
  type ErrorPayload,
  type GameStatePayload,
  type GameView,
  type NarratorRequestPayload,
  type RemovedPayload,
  type RemovedReason,
  type RoomInfo,
  type RoomNoticeKind,
  type RoomNoticePayload,
  type RoomPreview,
  type SessionInfo,
  type SettingsPatch,
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
import { freeBotName, randomBotAvatar } from "../bots/names.js";
import type { BotAction, BotPort, BotResult, BotSink } from "../bots/port.js";
import { AvatarStore, newAvatarId } from "./avatars.js";
import { MAX_CHAT_HISTORY, canSeeInHistory, sanitizeChatText } from "./chatRules.js";
import { digest, generateRoomCode, hashToken, newPlayerId, newSessionToken } from "./ids.js";
import { KeyedMutex } from "./keyedMutex.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import type { RoomStore } from "./roomStore.js";
import type { Scheduler } from "./scheduler.js";
import type { Room } from "./types.js";
import { upgradeRoom } from "./upgrade.js";

/** How the service talks to players. The Socket.IO layer implements it; tests use a fake. */
export interface Broadcaster {
  state(roomCode: string, playerId: string, payload: GameStatePayload): void;
  chat(roomCode: string, playerId: string, message: ChatMessage): void;
  chatHistory(roomCode: string, playerId: string, payload: ChatHistoryPayload): void;
  /** Tell the member they're out of the room and stop sending them anything from it. */
  removed(roomCode: string, playerId: string, payload: RemovedPayload): void;
  /** Ask the host's browser to write a narration. Only ever sent to the host. */
  narrationRequest(roomCode: string, playerId: string, payload: NarratorRequestPayload): void;
  /** Avatar pictures this member may see (only ever members of the room). */
  avatarImages(roomCode: string, playerId: string, payload: AvatarImagesPayload): void;
  /** A short message about someone in the room (joined, left, disconnected...). */
  notice(roomCode: string, playerId: string, payload: RoomNoticePayload): void;
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
  /** The host's last-used settings. Ignored if they aren't valid. */
  settings?: SettingsPatch;
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
  /** After a restart, how long everyone counts as "reconnecting" before being marked away (60 s by default). */
  recoveryGraceMs?: number;
}

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = <T = never>(code: ErrorCode, message: string): ServiceResult<T> => ({
  ok: false,
  error: { code, message },
});

/** Seats a bot plays right now: the host's bots, and players a bot stands in for. */
function botSeatIds(state: GameState): string[] {
  return state.players.filter((p) => !p.kicked && (p.isBot || p.botControlled)).map((p) => p.id);
}

function isBotSeat(state: GameState, id: string): boolean {
  const p = state.players.find((x) => x.id === id);
  return !!p && !p.kicked && (p.isBot || p.botControlled);
}

/** A real player who should get a bot instead of being marked away: in a running game, still in it, the host allowing it. */
function shouldTakeOver(state: GameState, id: string): boolean {
  const p = state.players.find((x) => x.id === id);
  return (
    !!p &&
    state.settings.botTakeover &&
    state.phase !== "LOBBY" &&
    state.phase !== "GAME_OVER" &&
    p.alive &&
    !p.kicked &&
    !p.isBot &&
    !p.botControlled
  );
}

const HOST_TIMER_ACTIONS = new Set<string>(["PAUSE", "RESUME", "ADD_TIME", "SKIP_TO_VOTING"]);

const REMOVED_NOTICE: Record<RemovedReason, RoomNoticeKind> = {
  left: "left",
  kicked: "kicked",
  dropped: "dropped",
  room_closed: "left",
};

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
export class RoomService implements BotPort {
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
  private readonly recoveryGraceMs: number;
  private readonly mutex = new KeyedMutex();
  /** ownerKey -> codes of their open rooms (rebuilt by recover()). */
  private readonly roomsByOwner = new Map<string, Set<string>>();
  /** room code -> id of the narration the host's browser has been asked to write. */
  private readonly narrationAsked = new Map<string, string>();
  /** Uploaded avatar pictures: memory only, never in the room's saved copy. */
  readonly avatars = new AvatarStore();
  /** Where bot seats get their deliveries (the bot manager). Null: bots sit still. */
  private botSink: BotSink | null = null;

  /** Connects the bots: from now on every bot seat gets exactly what its socket would get. */
  attachBots(sink: BotSink | null): void {
    this.botSink = sink;
  }

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
    this.recoveryGraceMs = options.recoveryGraceMs ?? 60_000;
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
    if (options.settings) {
      // The host's remembered settings, checked like any change. Bad ones are simply left out.
      const set = applyAction(joined.state, { type: "UPDATE_SETTINGS", playerId, settings: options.settings }, this.context());
      if (set.ok) joined.state = set.state;
    }

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
      botTarget: null,
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
  joinRoom(
    code: string,
    name: string,
    avatar: Avatar,
    password?: string,
    /** Server-side callers (the dev bots) that don't hold the room password. */
    trusted = false,
  ): Promise<ServiceResult<SessionInfo>> {
    return this.withRoom(code, async (room) => {
      if (room.passwordHash !== null && !trusted) {
        if (!password) return fail("PASSWORD_REQUIRED", "This room is private. Enter its password to join.");
        if (!(await verifyPassword(password, room.passwordHash))) {
          this.logger.warn("room.wrong_password", { room: code });
          return fail("WRONG_PASSWORD", "That password isn't right.");
        }
      }
      const before = room.state;
      const madeRoom = this.makeRoomForPerson(room, name);
      const playerId = newPlayerId();
      const sessionToken = newSessionToken();
      const prev = this.apply(room, { type: "JOIN", playerId, name, avatar });
      if (!prev.ok) return prev; // nothing is saved: the bots stay as they were
      room.sessions[hashToken(sessionToken)] = playerId;
      await this.commit(room, before);
      if (madeRoom) this.logger.info("bots.replaced", { room: code, bot: madeRoom });
      const seat = room.state.players.some((p) => p.id === playerId) ? "player" : "spectator";
      this.logger.info("player.joined", { room: code, player: playerId, seat, players: room.state.players.length });
      return ok({ roomCode: code, playerId, sessionToken, seat });
    });
  }

  /** Finds the member a session token belongs to. Doesn't change anything. */
  resumeSession(code: string, sessionToken: string): Promise<ServiceResult<SessionInfo>> {
    return this.withRoom(code, async (room) => {
      const memberId = this.memberForToken(room, sessionToken);
      if (memberId === null) return fail("SESSION_INVALID", "That session has expired. Please join again.");
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
      if (isBotSeat(room.state, memberId)) return ok(null);
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
      const player = room.state.players.find((p) => p.id === memberId);
      if (player?.isBot) return ok(null);
      if (player?.botControlled) {
        // Away for a while and a bot has been playing: back now, so they take their seat back.
        if (!connected) return ok(null);
        const prev = this.apply(room, { type: "BOT_RELEASE", playerId: memberId });
        if (!prev.ok) return prev;
        delete room.disconnectedAt[memberId];
        await this.commit(room, prev.value);
        this.logger.info("bot.released", { room: code, player: memberId });
        return ok(null);
      }
      if (!connected && shouldTakeOver(room.state, memberId)) {
        const prev = this.apply(room, { type: "BOT_TAKEOVER", playerId: memberId });
        if (!prev.ok) return prev;
        await this.commit(room, prev.value, { activity: false });
        this.logger.info("bot.takeover", { room: code, player: memberId });
        return ok(null);
      }
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
      // Leaving a running game: a bot plays on in the seat (if the host allows it), so the game isn't a player short.
      const action: GameAction = shouldTakeOver(room.state, memberId)
        ? { type: "BOT_TAKEOVER", playerId: memberId }
        : { type: "LEAVE", playerId: memberId };
      const prev = this.apply(room, action);
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

  /**
   * For the home screen's "Rejoin your last game": does the room still run, and
   * is this saved seat still yours? Changes nothing and joins nothing.
   */
  checkSeat(code: string, sessionToken: string): Promise<ServiceResult<CheckSeatResult>> {
    return this.withRoom(code, async (room) => {
      const { state } = room;
      const stage = state.phase === "LOBBY" ? "lobby" : state.phase === "GAME_OVER" ? "game_over" : "in_game";
      return ok({ roomCode: code, stage, seatValid: this.memberForToken(room, sessionToken) !== null });
    });
  }

  // ------------------------------------------------------------ avatar pictures

  /**
   * Before an upload is read: the session must belong to someone in the room,
   * in the lobby, with pictures allowed. Returns the member's id.
   */
  authorizeAvatarUpload(code: string, sessionToken: string): Promise<ServiceResult<{ memberId: string }>> {
    return this.withRoom(code, async (room) => {
      const memberId = this.memberForToken(room, sessionToken);
      if (memberId === null) return fail("SESSION_INVALID", "Your seat in this room has expired. Join again.");
      const problem = this.avatarUploadProblem(room);
      if (problem) return problem;
      return ok({ memberId });
    });
  }

  /**
   * Stores a picture the server has already re-encoded. Shows at once when
   * pictures are simply on (or it's the host's own); otherwise it waits for the host.
   */
  saveAvatar(code: string, memberId: string, dataUrl: string): Promise<ServiceResult<{ status: "pending" | "approved" }>> {
    return this.withRoom(code, async (room) => {
      if (!findMember(room.state, memberId)) return fail("NOT_IN_ROOM", "You are not in this room.");
      const problem = this.avatarUploadProblem(room);
      if (problem) return problem;
      const autoApprove = room.state.settings.customAvatars === "on" || room.state.hostId === memberId;
      const status = autoApprove ? "approved" : "pending";
      this.avatars.set(code, memberId, { id: newAvatarId(), dataUrl, status });
      room.lastActivityAt = this.clock();
      await this.publish(room);
      this.logger.info("avatar.uploaded", { room: code, player: memberId, status, pictures: this.avatars.size });
      return ok({ status });
    });
  }

  /** Back to the generated avatar: a player removes their own picture, or the host removes anyone's (any time). */
  removeAvatar(code: string, actorId: string, targetId: string): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      if (actorId !== targetId && room.state.hostId !== actorId) {
        return fail("NOT_HOST", "Only the host can remove someone else's picture.");
      }
      const target = findMember(room.state, targetId);
      if (!target) return fail("INVALID_TARGET", "That player isn't in the room.");
      if (!this.avatars.remove(code, targetId)) return ok(null);
      await this.publish(room);
      if (actorId !== targetId) {
        this.broadcaster.notice(code, targetId, { kind: "avatar_removed", playerId: targetId, name: target.name });
        this.logger.info("avatar.removed_by_host", { room: code, player: targetId });
      }
      return ok(null);
    });
  }

  /** Host: let a waiting picture show to everyone, or turn it down (it is deleted). */
  reviewAvatar(code: string, hostId: string, targetId: string, approve: boolean): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      if (room.state.hostId !== hostId) return fail("NOT_HOST", "Only the host can approve pictures.");
      const target = findMember(room.state, targetId);
      const avatar = this.avatars.get(code, targetId);
      if (!target || !avatar || avatar.status !== "pending") {
        return fail("INVALID_TARGET", "That picture isn't waiting for approval any more.");
      }
      if (approve) this.avatars.set(code, targetId, { ...avatar, status: "approved" });
      else this.avatars.remove(code, targetId);
      await this.publish(room);
      this.broadcaster.notice(code, targetId, {
        kind: approve ? "avatar_approved" : "avatar_rejected",
        playerId: targetId,
        name: target.name,
      });
      this.logger.info("avatar.reviewed", { room: code, player: targetId, approved: approve });
      return ok(null);
    });
  }

  private avatarUploadProblem(room: Room): ServiceResult<never> | null {
    if (room.state.settings.customAvatars === "off") {
      return fail("AVATARS_OFF", "The host has turned off custom pictures in this room.");
    }
    if (room.state.phase !== "LOBBY") return fail("WRONG_PHASE", "You can change your picture in the lobby.");
    return null;
  }

  /** The member a session token belongs to, if they're still in the room (and weren't removed). */
  private memberForToken(room: Room, sessionToken: string): string | null {
    const hashed = hashToken(sessionToken);
    const memberId = Object.hasOwn(room.sessions, hashed) ? room.sessions[hashed] : undefined;
    const member = memberId === undefined ? undefined : findMember(room.state, memberId);
    if (!memberId || !member || ("kicked" in member && member.kicked)) return null;
    return memberId;
  }

  // ------------------------------------------------------------ bots (host controls)

  /** Host, lobby: one more bot (at most 10, within the room's player limit). */
  addBot(code: string, hostId: string): Promise<ServiceResult<BotCountResult>> {
    return this.withRoom(code, async (room) => {
      const before = room.state;
      const added = this.applyAddBot(room, hostId);
      if (!added.ok) return added;
      room.botTarget = room.state.players.length;
      await this.commit(room, before);
      return ok(this.logBots(room, "bots.added", 1));
    });
  }

  /** Host, lobby: just enough bots to reach the minimum number of players (5). */
  fillBots(code: string, hostId: string): Promise<ServiceResult<BotCountResult>> {
    return this.withRoom(code, async (room) => {
      const before = room.state;
      let added = 0;
      while (room.state.players.length < MIN_PLAYERS) {
        const result = this.applyAddBot(room, hostId);
        if (!result.ok) {
          if (added === 0) return result;
          break;
        }
        added += 1;
      }
      if (added === 0 && room.state.hostId !== hostId) return fail("NOT_HOST", "Only the host can add bots.");
      if (added === 0 && room.state.phase !== "LOBBY") return fail("WRONG_PHASE", "Bots can only join in the lobby.");
      room.botTarget = room.state.players.length;
      if (added > 0) await this.commit(room, before);
      else await this.store.save(room);
      return ok(this.logBots(room, "bots.filled", added));
    });
  }

  /** Host, lobby: the newest bot leaves. */
  removeBot(code: string, hostId: string): Promise<ServiceResult<BotCountResult>> {
    return this.withRoom(code, async (room) => {
      const newest = [...room.state.players].reverse().find((p) => p.isBot);
      if (room.state.hostId !== hostId) return fail("NOT_HOST", "Only the host can remove bots.");
      if (!newest) return fail("INVALID_TARGET", "There are no bots to remove.");
      const prev = this.apply(room, { type: "REMOVE_BOT", playerId: hostId, botId: newest.id });
      if (!prev.ok) return prev;
      room.botTarget = room.state.players.length;
      await this.commit(room, prev.value, { removedReason: "left" });
      return ok(this.logBots(room, "bots.removed", 1));
    });
  }

  private applyAddBot(room: Room, hostId: string): ServiceResult<GameState> {
    const names = [...room.state.players, ...room.state.spectators].map((m) => m.name);
    return this.apply(room, {
      type: "ADD_BOT",
      playerId: hostId,
      botId: newPlayerId(),
      name: freeBotName(names, this.rng),
      avatar: randomBotAvatar(this.rng),
    });
  }

  private logBots(room: Room, event: string, changed: number): BotCountResult {
    const bots = room.state.players.filter((p) => p.isBot).length;
    const players = room.state.players.length;
    this.logger.info(event, { room: room.code, changed, bots, players });
    return { bots, players };
  }

  /**
   * Before a real player joins the lobby: a bot with the name they want takes
   * another, and (if the host allows it) a bot leaves when the room is full or
   * at the size the host filled it to. Returns the id of the bot that left.
   */
  private makeRoomForPerson(room: Room, rawName: string): string | null {
    const { state } = room;
    if (state.phase !== "LOBBY") return null;
    const wanted = validateNickname(rawName);
    if (wanted.ok) {
      const clash = state.players.find((p) => p.isBot && nicknameKey(p.name) === nicknameKey(wanted.value));
      if (clash) {
        const names = [...state.players, ...state.spectators].map((m) => m.name).concat(wanted.value);
        this.apply(room, { type: "UPDATE_PROFILE", playerId: clash.id, name: freeBotName(names, this.rng) });
      }
    }
    const players = room.state.players;
    const bots = players.filter((p) => p.isBot);
    const atSize = players.length >= MAX_PLAYERS || (room.botTarget !== null && players.length >= room.botTarget);
    const host = room.state.hostId;
    if (!room.state.settings.replaceBots || bots.length === 0 || !atSize || host === null) return null;
    const newest = bots[bots.length - 1];
    if (!newest) return null;
    return this.apply(room, { type: "REMOVE_BOT", playerId: host, botId: newest.id }).ok ? newest.id : null;
  }

  // ------------------------------------------------------------ bots (playing: the BotPort)

  /**
   * A bot's move for its own seat. Only seats a bot really plays are accepted,
   * only the actions a human player could send, and the engine checks them
   * exactly as it checks a human's (phase, role, life, targets).
   */
  botAct(code: string, seatId: string, action: BotAction): Promise<BotResult> {
    const allowed = ["SET_READY", "ACK_ROLE", "NIGHT_ACTION", "CAST_VOTE", "SKIP_DISCUSSION"];
    if (!allowed.includes((action as { type: string }).type)) {
      return Promise.resolve(fail("BAD_REQUEST", "Bots can only play their own seat."));
    }
    return this.withRoom(code, async (room) => {
      if (!isBotSeat(room.state, seatId)) return fail("NOT_IN_ROOM", "That seat isn't played by a bot.");
      const prev = this.apply(room, { ...action, playerId: seatId } as GameAction);
      if (!prev.ok) return prev;
      // Bots don't keep a room alive: only people count as activity.
      await this.commit(room, prev.value, { activity: false });
      return ok(null);
    });
  }

  botChat(code: string, seatId: string, text: string): Promise<BotResult> {
    return this.sendChat(code, seatId, text, { bot: true });
  }

  botReact(code: string, seatId: string, reaction: ChatReaction): Promise<BotResult> {
    return this.sendReaction(code, seatId, reaction, { bot: true });
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
      if (HOST_TIMER_ACTIONS.has(action.type)) {
        this.logger.info("host.timer", { room: code, action: action.type, phase: room.state.phase, round: room.state.round });
      }
      return ok(null);
    });
  }

  /** A typed message. The server picks the channel from who the sender is. */
  sendChat(code: string, memberId: string, rawText: string, opts: { bot?: boolean } = {}): Promise<ServiceResult<null>> {
    return this.relayChat(code, memberId, opts, (state) => {
      const cleaned = sanitizeChatText(rawText);
      if (cleaned === null) return fail("BAD_REQUEST", `Messages must be 1–${MAX_CHAT_LENGTH} characters.`);
      // Links are blocked at every filter level, uncensored included (spam and scam sites).
      if (containsLink(cleaned)) return fail("CHAT_LINK", "Links can't be shared in chat.");
      // Safe Mode is always strict; in Normal Mode the host picks strict, standard or uncensored.
      return ok({ text: filterChatText(cleaned, effectiveChatFilter(state.settings)) });
    });
  }

  /** A quick reaction, routed exactly like typed text. */
  sendReaction(
    code: string,
    memberId: string,
    reaction: ChatReaction,
    opts: { bot?: boolean } = {},
  ): Promise<ServiceResult<null>> {
    if (!(CHAT_REACTIONS as readonly string[]).includes(reaction)) {
      return Promise.resolve(fail("BAD_REQUEST", "Unknown reaction."));
    }
    return this.relayChat(code, memberId, opts, () => ok({ text: "", reaction }));
  }

  private relayChat(
    code: string,
    memberId: string,
    opts: { bot?: boolean },
    build: (state: GameState) => ServiceResult<{ text: string; reaction?: ChatReaction }>,
  ): Promise<ServiceResult<null>> {
    return this.withRoom(code, async (room) => {
      const { state } = room;
      const sender = findMember(state, memberId);
      if (!sender) return fail("NOT_IN_ROOM", "You are not in this room.");
      // A bot only speaks for a seat a bot plays; a person never speaks through a bot seat.
      if (opts.bot === true && !isBotSeat(state, memberId)) return fail("NOT_IN_ROOM", "That seat isn't played by a bot.");
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
      if (!opts.bot) room.lastActivityAt = message.sentAt;
      await this.store.save(room);

      for (const id of memberIds(state)) {
        if (canRead(state, id, channel)) this.sendChatTo(room, id, message);
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
      // A fresh connection (or a refreshed page) has no pictures yet: send them all again.
      this.avatars.resetDelivered(code, memberId);
      this.deliverAvatars(room);
      if (payload) this.sendState(room, memberId, payload);
      this.sendHistory(room, memberId);
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
   * After a server restart with a persistent store (Key Value), no connection
   * survived. Everyone who was connected gets the same grace as a dropped
   * connection: they show as "reconnecting" and still count as present, so a
   * night or a vote doesn't end early just because the server restarted. Whoever
   * hasn't come back when the grace runs out is marked away. Phase timers are
   * re-armed, and a room nobody returns to closes like any empty room.
   */
  async recover(): Promise<void> {
    const codes = await this.store.codes();
    for (const code of codes) {
      await this.withRoom(code, async (room) => {
        const now = this.clock();
        for (const id of memberIds(room.state)) {
          if (findMember(room.state, id)?.connected && !isBotSeat(room.state, id)) room.reconnecting[id] = now;
        }
        room.emptySince = room.emptySince ?? now;
        if (room.ownerKey) this.indexOwner(room.ownerKey, room.code);
        // Bots lost their memory with the old process: give each bot seat its view and chat again.
        const botPayloads = botSeatIds(room.state).map((id) => [id, this.prepareDelivery(room, id, now, true)] as const);
        await this.store.save(room);
        for (const [id, payload] of botPayloads) {
          if (payload) this.botSink?.state(code, id, payload);
          this.botSink?.chatHistory(code, id, { messages: room.chat.filter((m) => canSeeInHistory(room.state, id, m)) });
        }
        this.scheduleTimer(room);
        this.scheduler.set(`${code}:recovery`, now + this.recoveryGraceMs, () => {
          void this.endRecoveryGrace(code, now).catch((err: unknown) =>
            this.logger.error("rooms.recovery_grace_failed", { room: code }, err),
          );
        });
        return ok(null);
      });
    }
    if (codes.length > 0) this.logger.info("rooms.recovered", { rooms: codes.length });
  }

  /** The grace after a restart is over: anyone who still hasn't reconnected is marked away. */
  private async endRecoveryGrace(code: string, since: number): Promise<void> {
    await this.withRoom(code, async (room) => {
      const missing = Object.entries(room.reconnecting)
        .filter(([, at]) => at <= since)
        .map(([id]) => id);
      if (missing.length === 0) return ok(null);
      const prev = room.state;
      for (const id of missing) {
        delete room.reconnecting[id];
        const takeover = shouldTakeOver(room.state, id);
        const r = applyAction(room.state, { type: takeover ? "BOT_TAKEOVER" : "DISCONNECT", playerId: id }, this.context());
        if (r.ok) {
          room.state = r.state;
          if (!takeover) room.disconnectedAt[id] = this.clock();
        }
      }
      await this.commit(room, prev, { activity: false });
      this.logger.info("rooms.recovery_missing", { room: code, players: missing.length });
      return ok(null);
    });
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
      upgradeRoom(room);
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

    // Only people keep a room open: bots, and the bots standing in for players who are away, don't count.
    const people = [...state.players.filter((p) => !p.kicked && !p.isBot && !p.botControlled), ...state.spectators];
    room.emptySince = people.some((m) => m.connected) ? null : (room.emptySince ?? now);

    // Nobody but bots left (no real player, not even one who is away): the room closes.
    const humans = memberIds(state).filter((id) => !state.players.some((p) => p.id === id && p.isBot));
    if (remaining.size === 0 || humans.length === 0) {
      await this.close(room, "empty", gone);
      return;
    }

    // Pictures switched simply "on": anything still waiting for the host shows now.
    if (state.settings.customAvatars === "on") {
      for (const [id, avatar] of this.avatars.entries(room.code)) {
        if (avatar.status === "pending") this.avatars.set(room.code, id, { ...avatar, status: "approved" });
      }
    }

    const outgoing = this.prepareDeliveries(room, now);
    // A seat a bot has just started playing gets its full view now, whatever changed.
    const botsBefore = new Set(botSeatIds(prev));
    const botsNow = botSeatIds(state);
    const newBotSeats = botsNow.filter((id) => !botsBefore.has(id));
    for (const id of newBotSeats) {
      if (outgoing.some(([o]) => o === id)) continue;
      const payload = this.prepareDelivery(room, id, now, true);
      if (payload) outgoing.push([id, payload]);
    }
    await this.store.save(room);
    this.scheduleTimer(room);

    // Seats no longer played by a bot (removed, or their player is back): the bots let go first.
    for (const id of botsBefore) if (!botsNow.includes(id)) this.botSink?.release(room.code, id);

    const reason = opts.removedReason ?? "dropped";
    for (const id of gone) this.broadcaster.removed(room.code, id, { reason, message: REMOVED_MESSAGES[reason] });
    for (const id of newlyKicked) {
      this.broadcaster.removed(room.code, id, { reason: "kicked", message: REMOVED_MESSAGES.kicked });
    }
    this.deliverAvatars(room);
    for (const [id, payload] of outgoing) this.sendState(room, id, payload);
    for (const id of newBotSeats) this.sendHistory(room, id);
    this.sendNotices(room, prev, gone, newlyKicked, reason);

    // A result was just announced: ask the host's browser for the narration (or settle for a ready-made line).
    await this.requestNarration(room);

    // Someone just eliminated can now read the graveyard: give them its history (and drop Mafia chat).
    for (const p of state.players) {
      const wasAlive = prev.players.some((q) => q.id === p.id && q.alive);
      if (wasAlive && !p.alive && !p.kicked) this.sendHistory(room, p.id);
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
    this.deliverAvatars(room);
    for (const [id, payload] of outgoing) this.sendState(room, id, payload);
  }

  /**
   * Every delivery to a member goes through these: to their socket, and, for a
   * seat a bot plays, the very same payload to the bot. Nothing else reaches a bot.
   */
  private sendState(room: Room, id: string, payload: GameStatePayload): void {
    this.broadcaster.state(room.code, id, payload);
    if (isBotSeat(room.state, id)) this.botSink?.state(room.code, id, payload);
  }

  private sendChatTo(room: Room, id: string, message: ChatMessage): void {
    this.broadcaster.chat(room.code, id, message);
    if (isBotSeat(room.state, id)) this.botSink?.chat(room.code, id, message);
  }

  private sendHistory(room: Room, id: string): void {
    const payload = { messages: room.chat.filter((m) => canSeeInHistory(room.state, id, m)) };
    this.broadcaster.chatHistory(room.code, id, payload);
    if (isBotSeat(room.state, id)) this.botSink?.chatHistory(room.code, id, payload);
  }

  /** Which pictures a member may see: approved ones (unless pictures are off), their own, and, for the host, those waiting. */
  private visibleAvatarIds(room: Room, memberId: string): string[] {
    const policy = room.state.settings.customAvatars;
    if (policy === "off") return [];
    const isHost = room.state.hostId === memberId;
    return this.avatars
      .entries(room.code)
      .filter(([owner, a]) => a.status === "approved" || owner === memberId || (isHost && policy === "approval"))
      .map(([, a]) => a.id);
  }

  /** Sends each member (never anyone outside the room) the pictures they may see and don't have yet. */
  private deliverAvatars(room: Room): void {
    const kicked = new Set(room.state.players.filter((p) => p.kicked).map((p) => p.id));
    for (const id of memberIds(room.state)) {
      if (kicked.has(id)) continue;
      const fresh = this.avatars.takeUndelivered(room.code, id, this.visibleAvatarIds(room, id));
      const images = fresh.flatMap((imageId) => {
        const avatar = this.avatars.byId(room.code, imageId);
        return avatar ? [{ id: imageId, dataUrl: avatar.dataUrl }] : [];
      });
      if (images.length > 0) this.broadcaster.avatarImages(room.code, id, { images });
    }
  }

  /**
   * Short messages for everyone else about who joined, left, was removed, lost
   * their connection, came back, or became the host.
   */
  private sendNotices(room: Room, prev: GameState, gone: string[], newlyKicked: string[], reason: RemovedReason): void {
    const { state } = room;
    const notices: RoomNoticePayload[] = [];
    const before = new Map([...prev.players, ...prev.spectators].map((m) => [m.id, m]));
    const now = [...state.players, ...state.spectators];
    const botFlag = (m: { id: string }) => (prev.players.concat(state.players).some((p) => p.id === m.id && p.isBot) ? { isBot: true } : {});
    for (const id of gone) {
      const m = before.get(id);
      // A bot only ever leaves (the host removed it, or it made space for a person).
      if (!m) continue;
      const bot = botFlag(m);
      notices.push({ kind: bot.isBot ? "left" : REMOVED_NOTICE[reason], playerId: id, name: m.name, ...bot });
    }
    for (const id of newlyKicked) {
      const m = before.get(id);
      if (m) notices.push({ kind: "kicked", playerId: id, name: m.name });
    }
    for (const m of now) {
      const was = before.get(m.id);
      if (!was) notices.push({ kind: "joined", playerId: m.id, name: m.name, ...botFlag(m) });
      else if (was.connected && !m.connected && !newlyKicked.includes(m.id)) {
        // Leaving a running game keeps the seat as "away", but everyone should hear they left on purpose.
        notices.push({ kind: reason === "left" ? "left" : "disconnected", playerId: m.id, name: m.name });
      }
      else if (!was.connected && m.connected) notices.push({ kind: "reconnected", playerId: m.id, name: m.name });
    }
    // "A bot is now playing for Sam." / "Sam is back."
    for (const p of state.players) {
      const was = prev.players.find((q) => q.id === p.id);
      if (!was || p.kicked) continue;
      if (!was.botControlled && p.botControlled) notices.push({ kind: "bot_takeover", playerId: p.id, name: p.name });
      if (was.botControlled && !p.botControlled) notices.push({ kind: "bot_released", playerId: p.id, name: p.name });
    }
    const host = state.hostId === null ? undefined : state.players.find((p) => p.id === state.hostId);
    if (host && prev.hostId !== null && prev.hostId !== state.hostId) {
      notices.push({ kind: "host_changed", playerId: host.id, name: host.name });
    }
    if (notices.length === 0) return;
    const kicked = new Set(state.players.filter((p) => p.kicked).map((p) => p.id));
    for (const id of memberIds(state)) {
      if (kicked.has(id)) continue;
      for (const notice of notices) {
        if (notice.playerId !== id || notice.kind === "host_changed") this.broadcaster.notice(room.code, id, notice);
      }
    }
  }

  private forgetMember(room: Room, id: string): void {
    this.avatars.remove(room.code, id);
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

  /** The engine's view plus who is in their reconnect grace period, and the avatar pictures this member may see. */
  private viewFor(room: Room, memberId: string): GameView {
    const view = getGameView(room.state, memberId);
    const policy = room.state.settings.customAvatars;
    for (const m of [...view.players, ...view.spectators]) {
      if (m.connected && room.reconnecting[m.id] !== undefined) m.connection = "reconnecting";
      const avatar = this.avatars.get(room.code, m.id);
      if (policy !== "off" && avatar?.status === "approved") m.avatar.photo = avatar.id;
    }
    if (view.you) {
      const mine = this.avatars.get(room.code, view.you.id);
      view.you.photo = mine && policy !== "off" ? { id: mine.id, status: mine.status } : null;
      if (mine?.status === "approved" && policy !== "off") view.you.avatar.photo = mine.id;
    }
    if (policy === "approval" && room.state.hostId === memberId) {
      view.avatarRequests = this.avatars
        .entries(room.code)
        .filter(([owner, a]) => a.status === "pending" && owner !== memberId)
        .map(([owner, a]) => ({ playerId: owner, photo: a.id }));
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
    if (!host || !host.connected || host.botControlled || !facts) {
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
    this.avatars.removeRoom(room.code);
    for (const id of botSeatIds(room.state)) this.botSink?.release(room.code, id);
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
