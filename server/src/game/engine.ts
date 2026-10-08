import {
  MAX_PLAYERS,
  MAX_PLAYER_NAME_LENGTH,
  MIN_PLAYERS,
  defaultMafiaCount,
  maxMafiaCount,
  type GameError,
  type Phase,
} from "@mafia/shared";
import { isNightComplete, resolveNight, submitNightAction } from "./night.js";
import { buildRoleList, dealRoles } from "./roles.js";
import { cryptoRng } from "./rng.js";
import { emptyNight, findPlayer, resetGameData } from "./state.js";
import { mergeSettings } from "./settings.js";
import type { ActionResult, GameAction, GameContext, GameEnv, GameState } from "./types.js";
import { castVote, isVotingComplete, newVoting, resolveVoting } from "./voting.js";

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
      return join(s, a.playerId, a.name);
    case "LEAVE":
      return leave(s, a.playerId);
    case "DISCONNECT":
      return disconnect(s, a.playerId);
    case "RECONNECT":
      return reconnect(s, a.playerId);
    case "UPDATE_SETTINGS":
      return updateSettings(s, a.playerId, a.settings);
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

// ------------------------------------------------------------ lobby & presence

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    // control characters, zero-width and bidi-override characters
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const length = [...cleaned].length;
  return length >= 1 && length <= MAX_PLAYER_NAME_LENGTH ? cleaned : null;
}

/** Ids end up as object keys, so keep them boring ("skip" is the skip ballot). */
function isValidPlayerId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) && id !== "skip";
}

function join(s: GameState, playerId: string, rawName: string): GameError | null {
  if (s.phase !== "LOBBY") return err("WRONG_PHASE", "The game has already started.");
  if (!isValidPlayerId(playerId)) return err("INVALID_ID", "Invalid player id.");
  if (findPlayer(s, playerId)) return err("ALREADY_JOINED", "You are already in this room.");
  if (s.players.length >= MAX_PLAYERS) return err("ROOM_FULL", `The room is full (${MAX_PLAYERS} players).`);
  const name = normalizeName(rawName);
  if (!name) return err("INVALID_NAME", `Names must be 1–${MAX_PLAYER_NAME_LENGTH} characters.`);
  if (s.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return err("NAME_TAKEN", "Someone is already using that name.");
  }
  s.players.push({ id: playerId, name, role: null, alive: true, connected: true, ackedRole: false });
  if (s.hostId === null) s.hostId = playerId;
  return null;
}

/** Keeps the host a connected player where possible. */
function ensureHost(s: GameState): void {
  const host = s.hostId === null ? undefined : findPlayer(s, s.hostId);
  if (host?.connected) return;
  const next = s.players.find((p) => p.connected) ?? s.players[0];
  s.hostId = next?.id ?? null;
}

function disconnect(s: GameState, playerId: string): GameError | null {
  const player = findPlayer(s, playerId);
  if (!player) return err("NOT_IN_GAME", "You are not in this room.");
  player.connected = false;
  ensureHost(s);
  return null;
}

function reconnect(s: GameState, playerId: string): GameError | null {
  const player = findPlayer(s, playerId);
  if (!player) return err("NOT_IN_GAME", "You are not in this room.");
  player.connected = true;
  ensureHost(s);
  return null;
}

/** In the lobby (and after the game) leaving removes you; mid-game it counts as a disconnect. */
function leave(s: GameState, playerId: string): GameError | null {
  const player = findPlayer(s, playerId);
  if (!player) return err("NOT_IN_GAME", "You are not in this room.");
  if (s.phase === "LOBBY" || s.phase === "GAME_OVER") {
    s.players = s.players.filter((p) => p.id !== playerId);
    ensureHost(s);
    return null;
  }
  return disconnect(s, playerId);
}

function updateSettings(s: GameState, playerId: string, patch: unknown): GameError | null {
  if (s.phase !== "LOBBY") return err("WRONG_PHASE", "Settings can only change in the lobby.");
  if (playerId !== s.hostId) return err("NOT_HOST", "Only the host can change settings.");
  const result = mergeSettings(s.settings, patch);
  if (!result.ok) return err("INVALID_SETTINGS", result.message);
  s.settings = result.settings;
  return null;
}

// ------------------------------------------------------------ starting & restarting

function startGame(s: GameState, playerId: string, env: GameEnv): GameError | null {
  if (s.phase !== "LOBBY") return err("WRONG_PHASE", "The game has already started.");
  if (playerId !== s.hostId) return err("NOT_HOST", "Only the host can start the game.");

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

function restart(s: GameState, playerId: string): GameError | null {
  if (s.phase !== "GAME_OVER") return err("WRONG_PHASE", "The game isn't over yet.");
  if (playerId !== s.hostId) return err("NOT_HOST", "Only the host can start a new game.");
  s.players = s.players.filter((p) => p.connected);
  resetGameData(s);
  s.phase = "LOBBY";
  ensureHost(s);
  return null;
}

// ------------------------------------------------------------ in-game actions

function ackRole(s: GameState, playerId: string): GameError | null {
  if (s.phase !== "ROLE_REVEAL") return err("WRONG_PHASE", "It isn't time to look at roles.");
  const player = findPlayer(s, playerId);
  if (!player) return err("NOT_IN_GAME", "You are not in this game.");
  player.ackedRole = true;
  return null;
}

function nightAction(s: GameState, playerId: string, targetId: string, secondTargetId?: string): GameError | null {
  if (s.phase !== "NIGHT") return err("WRONG_PHASE", "It isn't night.");
  const player = findPlayer(s, playerId);
  if (!player) return err("NOT_IN_GAME", "You are not in this game.");
  if (!player.alive) return err("DEAD_PLAYER", "Eliminated players can't act.");
  return submitNightAction(s, player, targetId, secondTargetId);
}

function vote(s: GameState, playerId: string, targetId: string): GameError | null {
  if (s.phase !== "VOTING") return err("WRONG_PHASE", "Voting isn't open.");
  const player = findPlayer(s, playerId);
  if (!player) return err("NOT_IN_GAME", "You are not in this game.");
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
