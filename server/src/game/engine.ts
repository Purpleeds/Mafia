import {
  MAX_PLAYERS,
  MAX_SPECTATORS,
  MIN_PLAYERS,
  defaultMafiaCount,
  isAvatar,
  maxMafiaCount,
  nicknameKey,
  validateNickname,
  type Avatar,
  type GameError,
  type Phase,
} from "@mafia/shared";
import { isNightComplete, resolveNight, submitNightAction } from "./night.js";
import { buildRoleList, dealRoles } from "./roles.js";
import { cryptoRng } from "./rng.js";
import { emptyNight, findMember, findPlayer, findSpectator, resetGameData } from "./state.js";
import { mergeSettings } from "./settings.js";
import type { ActionResult, GameAction, GameContext, GameEnv, GameState, PlayerState } from "./types.js";
import { castVote, isVotingComplete, newVoting, resolveVoting } from "./voting.js";
import { evaluateWinner } from "./win.js";

const err = (code: GameError["code"], message: string): GameError => ({ code, message });

/**
 * The single entry point: takes the current state and one action, and returns
 * either a brand-new state or an error. The input state is never modified.
 *
 * Time comes from `ctx.now` and randomness from `ctx.rng`, so the engine has no
 * hidden inputs. The caller schedules a TICK at `state.phaseEndsAt`.
 */
export function applyAction(state: GameState, action: GameAction, ctx: GameContext): ActionResult {
  const draft = structuredClone(state);
  const env: GameEnv = { now: ctx.now, rng: ctx.rng ?? cryptoRng };
  const error = dispatch(draft, action, env);
  if (error) return { ok: false, error };
  advanceIfReady(draft, env);
  return { ok: true, state: draft };
}

function dispatch(s: GameState, a: GameAction, env: GameEnv): GameError | null {
  switch (a.type) {
    case "JOIN":
      return join(s, a.playerId, a.name, a.avatar);
    case "LEAVE":
      return leave(s, a.playerId);
    case "DISCONNECT":
      return setConnected(s, a.playerId, false);
    case "RECONNECT":
      return setConnected(s, a.playerId, true);
    case "UPDATE_SETTINGS":
      return updateSettings(s, a.playerId, a.settings);
    case "UPDATE_PROFILE":
      return updateProfile(s, a.playerId, a.name, a.avatar);
    case "KICK":
      return kick(s, a.playerId, a.targetId, env);
    case "TRANSFER_HOST":
      return transferHost(s, a.playerId, a.targetId);
    case "START_GAME":
      return startGame(s, a.playerId, env);
    case "ACK_ROLE":
      return ackRole(s, a.playerId);
    case "NIGHT_ACTION":
      return nightAction(s, a.playerId, a.targetId, a.secondTargetId);
    case "CAST_VOTE":
      return vote(s, a.playerId, a.targetId);
    case "TICK":
      if (s.phaseEndsAt !== null && env.now >= s.phaseEndsAt) advance(s, env);
      return null;
    case "RESTART":
      return restart(s, a.playerId);
  }
}

// ------------------------------------------------------------ names & members

/** The cleaned nickname, or null if it isn't allowed (see validateNickname). */
export function normalizeName(raw: unknown): string | null {
  const result = validateNickname(raw);
  return result.ok ? result.value : null;
}

/** Ids end up as object keys, so keep them boring ("skip" is the skip ballot). */
function isValidPlayerId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) && id !== "skip";
}

/** Nicknames are unique (ignoring case) across players and spectators. */
function nameTaken(s: GameState, name: string, exceptId?: string): boolean {
  const key = nicknameKey(name);
  return [...s.players, ...s.spectators].some((m) => m.id !== exceptId && nicknameKey(m.name) === key);
}

function checkName(s: GameState, raw: unknown, exceptId?: string): { name: string } | GameError {
  const result = validateNickname(raw);
  if (!result.ok) return err("INVALID_NAME", result.reason);
  if (nameTaken(s, result.value, exceptId)) return err("NAME_TAKEN", "Someone in this room already has that nickname.");
  return { name: result.value };
}

function canBeHost(p: PlayerState): boolean {
  return p.connected && !p.kicked;
}

/**
 * Keeps a present player as host. If the host is gone, it passes to the next
 * present player after them in join order (wrapping round).
 * `fromIndex` is where to start looking (defaults to just after the host).
 */
function ensureHost(s: GameState, fromIndex?: number): void {
  const current = s.hostId === null ? undefined : findPlayer(s, s.hostId);
  if (current && canBeHost(current)) return;
  const n = s.players.length;
  if (n === 0) {
    s.hostId = null;
    return;
  }
  const start = fromIndex ?? (current ? s.players.indexOf(current) + 1 : 0);
  for (let i = 0; i < n; i++) {
    const candidate = s.players[(((start + i) % n) + n) % n];
    if (candidate && canBeHost(candidate)) {
      s.hostId = candidate.id;
      return;
    }
  }
  // Nobody is present: keep the current host if they're still in the room.
  if (!current) s.hostId = s.players[0]?.id ?? null;
}

// ------------------------------------------------------------ lobby & presence

function join(s: GameState, playerId: string, rawName: string, avatar: Avatar): GameError | null {
  if (!isValidPlayerId(playerId)) return err("INVALID_ID", "Invalid player id.");
  if (findMember(s, playerId)) return err("ALREADY_JOINED", "You are already in this room.");
  if (!isAvatar(avatar)) return err("INVALID_AVATAR", "Pick an avatar colour and look.");
  const checked = checkName(s, rawName);
  if ("code" in checked) return checked;

  if (s.phase === "LOBBY") {
    if (s.players.length >= MAX_PLAYERS) return err("ROOM_FULL", `The room is full (${MAX_PLAYERS} players).`);
    s.players.push({
      id: playerId,
      name: checked.name,
      avatar: { color: avatar.color, seed: avatar.seed },
      role: null,
      alive: true,
      connected: true,
      ackedRole: false,
      kicked: false,
    });
    if (s.hostId === null) s.hostId = playerId;
    return null;
  }

  // A game is running (or just finished): watch until the next one.
  if (s.spectators.length >= MAX_SPECTATORS) return err("ROOM_FULL", "This room can't take any more spectators.");
  s.spectators.push({ id: playerId, name: checked.name, avatar: { color: avatar.color, seed: avatar.seed }, connected: true });
  return null;
}

function setConnected(s: GameState, playerId: string, connected: boolean): GameError | null {
  const member = findMember(s, playerId);
  if (!member) return err("NOT_IN_GAME", "You are not in this room.");
  if ("kicked" in member && member.kicked) return err("NOT_IN_GAME", "You were removed from this game.");
  member.connected = connected;
  ensureHost(s);
  return null;
}

/** Spectators can always leave. Players leave the lobby (or a finished game); mid-game it counts as a disconnect. */
function leave(s: GameState, playerId: string): GameError | null {
  if (findSpectator(s, playerId)) {
    s.spectators = s.spectators.filter((p) => p.id !== playerId);
    return null;
  }
  const player = findPlayer(s, playerId);
  if (!player) return err("NOT_IN_GAME", "You are not in this room.");
  if (s.phase === "LOBBY" || s.phase === "GAME_OVER") {
    removePlayer(s, playerId);
    return null;
  }
  return setConnected(s, playerId, false);
}

function removePlayer(s: GameState, playerId: string): void {
  const index = s.players.findIndex((p) => p.id === playerId);
  if (index === -1) return;
  s.players.splice(index, 1);
  // The player after the leaver now sits at `index`.
  if (s.hostId === playerId) {
    s.hostId = null;
    ensureHost(s, index);
  }
}

function requireHost(s: GameState, playerId: string, what: string): GameError | null {
  return playerId === s.hostId ? null : err("NOT_HOST", `Only the host can ${what}.`);
}

function updateSettings(s: GameState, playerId: string, patch: unknown): GameError | null {
  if (s.phase !== "LOBBY") return err("WRONG_PHASE", "Settings can only change in the lobby.");
  const notHost = requireHost(s, playerId, "change settings");
  if (notHost) return notHost;
  const result = mergeSettings(s.settings, patch);
  if (!result.ok) return err("INVALID_SETTINGS", result.message);
  s.settings = result.settings;
  return null;
}

/** Change your own nickname and/or avatar, in the lobby. */
function updateProfile(s: GameState, playerId: string, rawName?: string, avatar?: Avatar): GameError | null {
  if (s.phase !== "LOBBY") return err("WRONG_PHASE", "You can change your name and avatar in the lobby.");
  const member = findMember(s, playerId);
  if (!member) return err("NOT_IN_GAME", "You are not in this room.");
  if (avatar !== undefined && !isAvatar(avatar)) return err("INVALID_AVATAR", "Pick an avatar colour and look.");
  let name = member.name;
  if (rawName !== undefined) {
    const checked = checkName(s, rawName, playerId);
    if ("code" in checked) return checked;
    name = checked.name;
  }
  member.name = name;
  if (avatar !== undefined) member.avatar = { color: avatar.color, seed: avatar.seed };
  return null;
}

/**
 * Host removes someone. Spectators, and players in the lobby or after the game,
 * leave the room. A player in a running game is taken out of it: they count as
 * eliminated (their linked partner is not affected), any choices they made or
 * that targeted them are dropped, and the game ends at once if that decides it.
 */
function kick(s: GameState, playerId: string, targetId: string, env: GameEnv): GameError | null {
  const notHost = requireHost(s, playerId, "remove players");
  if (notHost) return notHost;
  if (targetId === playerId) return err("INVALID_TARGET", "You can't remove yourself. Leave the room instead.");

  if (findSpectator(s, targetId)) {
    s.spectators = s.spectators.filter((p) => p.id !== targetId);
    return null;
  }
  const target = findPlayer(s, targetId);
  if (!target || target.kicked) return err("INVALID_TARGET", "That player isn't in the room.");
  if (s.phase === "LOBBY" || s.phase === "GAME_OVER") {
    removePlayer(s, targetId);
    return null;
  }

  target.kicked = true;
  target.alive = false;
  target.connected = false;
  target.ackedRole = true;
  forgetChoicesInvolving(s, target);

  const winner = evaluateWinner(s);
  if (winner) {
    s.pendingWinner = winner;
    endGame(s, env);
  }
  return null;
}

function forgetChoicesInvolving(s: GameState, target: PlayerState): void {
  const id = target.id;
  const { night } = s;
  delete night.mafiaVotes[id];
  for (const [voter, choice] of Object.entries(night.mafiaVotes)) if (choice === id) delete night.mafiaVotes[voter];
  // Their own choice (they are the only holder of their role) and choices aimed at them.
  if (target.role === "doctor" || night.protect === id) night.protect = null;
  if (target.role === "detective" || night.investigate === id) night.investigate = null;
  if (target.role === "bodyguard" || night.guard === id) night.guard = null;
  if (target.role === "cupid" || night.link?.includes(id)) night.link = null;

  if (s.voting) {
    delete s.voting.ballots[id];
    for (const [voter, choice] of Object.entries(s.voting.ballots)) if (choice === id) delete s.voting.ballots[voter];
    if (s.voting.candidates) s.voting.candidates = s.voting.candidates.filter((c) => c !== id);
  }
}

/** Host hands the role to another present player (any phase). */
function transferHost(s: GameState, playerId: string, targetId: string): GameError | null {
  const notHost = requireHost(s, playerId, "hand over hosting");
  if (notHost) return notHost;
  const target = findPlayer(s, targetId);
  if (!target || targetId === playerId) return err("INVALID_TARGET", "Pick another player in the room.");
  if (!canBeHost(target)) return err("INVALID_TARGET", "That player isn't connected right now.");
  s.hostId = targetId;
  return null;
}

// ------------------------------------------------------------ starting & restarting

function startGame(s: GameState, playerId: string, env: GameEnv): GameError | null {
  if (s.phase !== "LOBBY") return err("WRONG_PHASE", "The game has already started.");
  const notHost = requireHost(s, playerId, "start the game");
  if (notHost) return notHost;

  // Anyone who dropped out of the lobby is left behind.
  const playing = s.players.filter((p) => p.connected);
  const n = playing.length;
  if (n < MIN_PLAYERS) return err("NOT_ENOUGH_PLAYERS", `You need at least ${MIN_PLAYERS} connected players.`);

  const { mafiaCount: setting, optionalRoles } = s.settings;
  const mafiaCount = setting === "auto" ? defaultMafiaCount(n) : setting;
  if (mafiaCount > maxMafiaCount(n)) {
    return err("INVALID_SETTINGS", `${n} players can have at most ${maxMafiaCount(n)} Mafia.`);
  }
  const roles = buildRoleList(n, mafiaCount, optionalRoles);
  if (!roles) return err("TOO_MANY_ROLES", `There aren't enough players for ${mafiaCount} Mafia and the chosen roles.`);

  s.players = playing;
  resetGameData(s);
  const dealt = dealRoles(
    s.players.map((p) => p.id),
    roles,
    env.rng,
  );
  for (const p of s.players) p.role = dealt[p.id] ?? "villager";
  s.mafiaCount = mafiaCount;
  ensureHost(s);
  enterPhase(s, "ROLE_REVEAL", env);
  return null;
}

/** Back to the lobby: absent and removed players leave, spectators join in (while there's room). */
function restart(s: GameState, playerId: string): GameError | null {
  if (s.phase !== "GAME_OVER") return err("WRONG_PHASE", "The game isn't over yet.");
  const notHost = requireHost(s, playerId, "start a new game");
  if (notHost) return notHost;
  s.players = s.players.filter((p) => p.connected && !p.kicked);
  const waiting = s.spectators.filter((p) => p.connected);
  s.spectators = [];
  for (const spectator of waiting) {
    if (s.players.length < MAX_PLAYERS) {
      s.players.push({ ...spectator, role: null, alive: true, ackedRole: false, kicked: false });
    } else {
      s.spectators.push(spectator);
    }
  }
  resetGameData(s);
  s.phase = "LOBBY";
  ensureHost(s);
  return null;
}

// ------------------------------------------------------------ in-game actions

function activePlayer(s: GameState, playerId: string): PlayerState | GameError {
  const player = findPlayer(s, playerId);
  if (player) return player;
  if (findSpectator(s, playerId)) return err("SPECTATOR", "You're watching this game. You'll play in the next one.");
  return err("NOT_IN_GAME", "You are not in this game.");
}

function ackRole(s: GameState, playerId: string): GameError | null {
  if (s.phase !== "ROLE_REVEAL") return err("WRONG_PHASE", "It isn't time to look at roles.");
  const player = activePlayer(s, playerId);
  if ("code" in player) return player;
  player.ackedRole = true;
  return null;
}

function nightAction(s: GameState, playerId: string, targetId: string, secondTargetId?: string): GameError | null {
  if (s.phase !== "NIGHT") return err("WRONG_PHASE", "It isn't night.");
  const player = activePlayer(s, playerId);
  if ("code" in player) return player;
  if (!player.alive) return err("DEAD_PLAYER", "Eliminated players can't act.");
  return submitNightAction(s, player, targetId, secondTargetId);
}

function vote(s: GameState, playerId: string, targetId: string): GameError | null {
  if (s.phase !== "VOTING") return err("WRONG_PHASE", "Voting isn't open.");
  const player = activePlayer(s, playerId);
  if ("code" in player) return player;
  return castVote(s, player, targetId);
}

// ------------------------------------------------------------ phase machine

function phaseSeconds(s: GameState, phase: Phase): number | null {
  const t = s.settings.timers;
  switch (phase) {
    case "ROLE_REVEAL":
      return t.roleRevealSeconds;
    case "NIGHT":
      return t.nightSeconds;
    case "NIGHT_RESULTS":
      return t.nightResultsSeconds;
    case "DAY_DISCUSSION":
      return t.discussionSeconds;
    case "VOTING":
      return t.votingSeconds;
    case "VOTE_RESULTS":
      return t.voteResultsSeconds;
    case "LOBBY":
    case "GAME_OVER":
      return null;
  }
}

function enterPhase(s: GameState, phase: Phase, env: GameEnv): void {
  s.phase = phase;
  const seconds = phaseSeconds(s, phase);
  s.phaseEndsAt = seconds === null ? null : env.now + seconds * 1000;
}

function startNight(s: GameState, env: GameEnv): void {
  s.round += 1;
  s.night = emptyNight();
  s.voting = null;
  s.nightReport = null;
  s.voteReport = null;
  enterPhase(s, "NIGHT", env);
}

function endGame(s: GameState, env: GameEnv): void {
  s.winner = s.pendingWinner;
  s.voting = null;
  enterPhase(s, "GAME_OVER", env);
}

/** Moves to the next phase, whether because the timer ran out or everyone has acted. */
function advance(s: GameState, env: GameEnv): void {
  switch (s.phase) {
    case "ROLE_REVEAL":
      startNight(s, env);
      break;
    case "NIGHT":
      resolveNight(s, env);
      enterPhase(s, "NIGHT_RESULTS", env);
      break;
    case "NIGHT_RESULTS":
      if (s.pendingWinner) endGame(s, env);
      else enterPhase(s, "DAY_DISCUSSION", env);
      break;
    case "DAY_DISCUSSION":
      s.voting = newVoting();
      enterPhase(s, "VOTING", env);
      break;
    case "VOTING":
      // A tie with the revote rule stays in VOTING (round 2); otherwise show the result.
      if (resolveVoting(s, env)) enterPhase(s, "VOTE_RESULTS", env);
      break;
    case "VOTE_RESULTS":
      if (s.pendingWinner) endGame(s, env);
      else startNight(s, env);
      break;
    case "LOBBY":
    case "GAME_OVER":
      break;
  }
}

/** Ends the phase early once everyone who is required to act has acted. */
function advanceIfReady(s: GameState, env: GameEnv): void {
  switch (s.phase) {
    case "ROLE_REVEAL": {
      const here = s.players.filter((p) => p.connected);
      if (here.length > 0 && here.every((p) => p.ackedRole)) advance(s, env);
      break;
    }
    case "NIGHT":
      if (isNightComplete(s)) advance(s, env);
      break;
    case "VOTING":
      if (isVotingComplete(s)) advance(s, env);
      break;
    default:
      break;
  }
}
