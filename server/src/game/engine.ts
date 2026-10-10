import {
  ADD_TIME_SECONDS,
  MAX_BOTS,
  MAX_PHASE_REMAINING_SECONDS,
  MAX_PLAYERS,
  MIN_HUMANS,
  MAX_SPECTATORS,
  MIN_PLAYERS,
  VOTE_LAST_CALL_SECONDS,
  defaultMafiaCount,
  isAvatar,
  maxMafiaCount,
  nicknameKey,
  validateNickname,
  type Avatar,
  type GameError,
  type Phase,
} from "@mafia/shared";
import { beginNarration, expireNarration, isNarrationPending, narrate } from "./narrate.js";
import { isNightComplete, resolveNight, submitNightAction } from "./night.js";
import { buildRoleList, dealRoles } from "./roles.js";
import { cryptoRng } from "./rng.js";
import { emptyNight, findMember, findPlayer, findSpectator, resetGameData } from "./state.js";
import { mergeSettings } from "./settings.js";
import type { ActionResult, GameAction, GameContext, GameEnv, GameState, LogEntry, PlayerState } from "./types.js";
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
    case "SET_READY":
      return setReady(s, a.playerId, a.ready);
    case "ADD_BOT":
      return addBot(s, a.playerId, a.botId, a.name, a.avatar);
    case "REMOVE_BOT":
      return removeBot(s, a.playerId, a.botId);
    case "BOT_TAKEOVER":
      return botTakeover(s, a.playerId);
    case "BOT_RELEASE":
      return botRelease(s, a.playerId);
    case "PAUSE":
      return pause(s, a.playerId, env);
    case "RESUME":
      return resume(s, a.playerId, env);
    case "ADD_TIME":
      return addTime(s, a.playerId, env);
    case "SKIP_TO_VOTING":
      return skipToVoting(s, a.playerId, env);
    case "SKIP_DISCUSSION":
      return skipDiscussion(s, a.playerId, a.skip);
    case "NARRATE":
      return narrate(s, a.candidate, a.reason, env);
    case "TICK":
      expireNarration(s, env);
      // While paused the phase timer is off (phaseEndsAt is null), so only the narrator's deadline counts.
      if (!s.paused && s.phaseEndsAt !== null && env.now >= s.phaseEndsAt) advance(s, env);
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

/** A present, real player: bots, and players a bot is standing in for, can't host. */
function canBeHost(p: PlayerState): boolean {
  return p.connected && !p.kicked && !p.isBot && !p.botControlled;
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
  // Nobody is present: keep the current host if they're still in the room, otherwise the first real
  // player (never a bot; with none, the next person to join becomes host).
  if (!current) s.hostId = s.players.find((p) => !p.isBot)?.id ?? null;
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
      ready: false,
      isBot: false,
      botControlled: false,
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
  addLog(s, { kind: "kicked", round: s.round, playerId: target.id });

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

  s.discussionDone = s.discussionDone.filter((d) => d !== id);
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
  const humans = playing.filter((p) => !p.isBot).length;
  if (humans < MIN_HUMANS && !s.settings.soloPractice) {
    return err(
      "NOT_ENOUGH_PLAYERS",
      `You need at least ${MIN_HUMANS} real players. Turn on solo practice to play with just bots.`,
    );
  }

  const { mafiaCount: setting, optionalRoles } = s.settings;
  const mafiaCount = setting === "auto" ? defaultMafiaCount(n) : setting;
  if (mafiaCount > maxMafiaCount(n)) {
    return err("INVALID_SETTINGS", `${n} players can have at most ${maxMafiaCount(n)} Mafia.`);
  }
  const roles = buildRoleList(n, mafiaCount, optionalRoles);
  if (!roles) return err("TOO_MANY_ROLES", `There aren't enough players for ${mafiaCount} Mafia and the chosen roles.`);

  s.players = playing;
  resetGameData(s);
  s.gameNumber += 1;
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
  // Players a bot was standing in for were away at the end: they leave like any absent player.
  s.players = s.players.filter((p) => p.connected && !p.kicked && !p.botControlled);
  const waiting = s.spectators.filter((p) => p.connected);
  s.spectators = [];
  for (const spectator of waiting) {
    if (s.players.length < MAX_PLAYERS) {
      s.players.push({
        ...spectator,
        role: null,
        alive: true,
        ackedRole: false,
        kicked: false,
        ready: false,
        isBot: false,
        botControlled: false,
      });
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
  if (!player.alive) return err("DEAD_PLAYER", "You're out of this game, so you can't do that.");
  return submitNightAction(s, player, targetId, secondTargetId);
}

function vote(s: GameState, playerId: string, targetId: string): GameError | null {
  if (s.phase !== "VOTING") return err("WRONG_PHASE", "Voting isn't open.");
  const player = activePlayer(s, playerId);
  if ("code" in player) return player;
  return castVote(s, player, targetId);
}

/** Lobby: ready to play (or not). The host's Start button lights up when everyone is. */
function setReady(s: GameState, playerId: string, ready: boolean): GameError | null {
  if (s.phase !== "LOBBY") return err("WRONG_PHASE", "You can only get ready in the lobby.");
  const player = activePlayer(s, playerId);
  if ("code" in player) return player;
  player.ready = ready;
  return null;
}

// ------------------------------------------------------------ bots

/** Host, lobby: a bot joins as an ordinary player, ready to play. */
function addBot(s: GameState, playerId: string, botId: string, rawName: string, avatar: Avatar): GameError | null {
  if (s.phase !== "LOBBY") return err("WRONG_PHASE", "Bots can only join in the lobby.");
  const notHost = requireHost(s, playerId, "add bots");
  if (notHost) return notHost;
  if (!isValidPlayerId(botId) || findMember(s, botId)) return err("INVALID_ID", "Invalid bot id.");
  if (!isAvatar(avatar)) return err("INVALID_AVATAR", "Pick an avatar colour and look.");
  if (s.players.filter((p) => p.isBot).length >= MAX_BOTS) {
    return err("ROOM_FULL", `A room can have at most ${MAX_BOTS} bots.`);
  }
  if (s.players.length >= MAX_PLAYERS) return err("ROOM_FULL", `The room is full (${MAX_PLAYERS} players).`);
  const checked = checkName(s, rawName);
  if ("code" in checked) return checked;
  s.players.push({
    id: botId,
    name: checked.name,
    avatar: { color: avatar.color, seed: avatar.seed },
    role: null,
    alive: true,
    connected: true,
    ackedRole: false,
    kicked: false,
    ready: true,
    isBot: true,
    botControlled: false,
  });
  return null;
}

/** Host, lobby: a bot leaves. */
function removeBot(s: GameState, playerId: string, botId: string): GameError | null {
  if (s.phase !== "LOBBY") return err("WRONG_PHASE", "Bots can only be removed in the lobby.");
  const notHost = requireHost(s, playerId, "remove bots");
  if (notHost) return notHost;
  if (!findPlayer(s, botId)?.isBot) return err("INVALID_TARGET", "That isn't a bot.");
  removePlayer(s, botId);
  return null;
}

/**
 * Server only: a real player has stayed away past the grace period during a
 * game, so a bot plays their seat (with exactly their view). They stay present
 * for the game, but hosting passes to someone who is really here.
 */
function botTakeover(s: GameState, playerId: string): GameError | null {
  if (s.phase === "LOBBY" || s.phase === "GAME_OVER") return err("WRONG_PHASE", "Bots only stand in during a game.");
  const player = findPlayer(s, playerId);
  if (!player || player.isBot || player.kicked || !player.alive) return err("INVALID_TARGET", "No bot is needed for that seat.");
  player.botControlled = true;
  player.connected = true;
  ensureHost(s);
  return null;
}

/** Server only: the player is back and plays their own seat again. */
function botRelease(s: GameState, playerId: string): GameError | null {
  const player = findPlayer(s, playerId);
  if (!player?.botControlled) return err("INVALID_TARGET", "No bot is playing that seat.");
  player.botControlled = false;
  player.connected = true;
  ensureHost(s);
  return null;
}

/** Day discussion: a living player is done talking. When everyone is, voting starts (see advanceIfReady). */
function skipDiscussion(s: GameState, playerId: string, skip: boolean): GameError | null {
  if (s.phase !== "DAY_DISCUSSION") return err("WRONG_PHASE", "You can only skip the discussion while it's on.");
  const player = activePlayer(s, playerId);
  if ("code" in player) return player;
  if (!player.alive) return err("DEAD_PLAYER", "You're out of this game, so you can't vote to skip.");
  const others = s.discussionDone.filter((id) => id !== playerId);
  s.discussionDone = skip ? [...others, playerId] : others;
  return null;
}

// ------------------------------------------------------------ host's timer controls

const TIMED_PHASES: readonly Phase[] = ["ROLE_REVEAL", "NIGHT", "NIGHT_RESULTS", "DAY_DISCUSSION", "VOTING", "VOTE_RESULTS"];

function addLog(s: GameState, entry: LogEntry): void {
  s.log.push(entry);
}

function requireTimedPhase(s: GameState): GameError | null {
  return TIMED_PHASES.includes(s.phase) ? null : err("WRONG_PHASE", "There's no timer to change right now.");
}

/** Freezes the timer. Votes and choices still count; the phase just won't end until the host resumes. */
function pause(s: GameState, playerId: string, env: GameEnv): GameError | null {
  const problem = requireHost(s, playerId, "pause the game") ?? requireTimedPhase(s);
  if (problem) return problem;
  if (s.paused) return null;
  s.paused = { remainingMs: Math.max(0, (s.phaseEndsAt ?? env.now) - env.now) };
  s.phaseEndsAt = null;
  addLog(s, { kind: "paused", round: s.round, phase: s.phase });
  return null;
}

/** Starts the timer again with the time that was left (at least a few seconds, so nobody is caught out). */
function resume(s: GameState, playerId: string, env: GameEnv): GameError | null {
  const notHost = requireHost(s, playerId, "resume the game");
  if (notHost) return notHost;
  if (!s.paused) return null;
  s.phaseEndsAt = env.now + Math.max(s.paused.remainingMs, 3000);
  s.paused = null;
  addLog(s, { kind: "resumed", round: s.round, phase: s.phase });
  return null;
}

/** Adds 30 seconds to the current phase (paused or not), up to 15 minutes left. */
function addTime(s: GameState, playerId: string, env: GameEnv): GameError | null {
  const problem = requireHost(s, playerId, "add time") ?? requireTimedPhase(s);
  if (problem) return problem;
  const extra = ADD_TIME_SECONDS * 1000;
  const left = s.paused ? s.paused.remainingMs : Math.max(0, (s.phaseEndsAt ?? env.now) - env.now);
  if (left + extra > MAX_PHASE_REMAINING_SECONDS * 1000) {
    return err("TIME_LIMIT", `A phase can't have more than ${MAX_PHASE_REMAINING_SECONDS / 60} minutes left.`);
  }
  if (s.paused) s.paused.remainingMs += extra;
  else s.phaseEndsAt = env.now + left + extra;
  addLog(s, { kind: "time_added", round: s.round, phase: s.phase });
  return null;
}

/** Ends the day discussion now and opens voting. */
function skipToVoting(s: GameState, playerId: string, env: GameEnv): GameError | null {
  const notHost = requireHost(s, playerId, "skip to voting");
  if (notHost) return notHost;
  if (s.phase !== "DAY_DISCUSSION") return err("WRONG_PHASE", "You can only skip to voting during the discussion.");
  addLog(s, { kind: "discussion_skipped", round: s.round, by: "host" });
  advance(s, env);
  return null;
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
  s.paused = null;
  s.discussionDone = [];
  const seconds = phaseSeconds(s, phase);
  s.phaseEndsAt = seconds === null ? null : env.now + seconds * 1000;
}

function startNight(s: GameState, env: GameEnv): void {
  s.round += 1;
  s.night = emptyNight();
  s.voting = null;
  s.nightReport = null;
  s.voteReport = null;
  s.narration = null;
  enterPhase(s, "NIGHT", env);
}

function endGame(s: GameState, env: GameEnv): void {
  s.winner = s.pendingWinner;
  s.voting = null;
  s.narration = null;
  enterPhase(s, "GAME_OVER", env);
}

/** Moves to the next phase, whether because the timer ran out or everyone has acted. */
function advance(s: GameState, env: GameEnv): void {
  // The results screens wait for the narrator (see beginNarration).
  if (isNarrationPending(s)) return;
  switch (s.phase) {
    case "ROLE_REVEAL":
      startNight(s, env);
      break;
    case "NIGHT":
      resolveNight(s, env);
      enterPhase(s, "NIGHT_RESULTS", env);
      if (s.nightReport) {
        addLog(s, { kind: "night", round: s.round, deaths: [...s.nightReport.deaths], saved: s.nightReport.saved });
      }
      beginNarration(s, "night", env);
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
      if (resolveVoting(s, env)) {
        enterPhase(s, "VOTE_RESULTS", env);
        if (s.voteReport) {
          addLog(s, { kind: "vote", round: s.round, outcome: s.voteReport.outcome, deaths: [...s.voteReport.deaths] });
        }
        beginNarration(s, "vote", env);
      } else if (s.voting?.previous) {
        addLog(s, { kind: "revote", round: s.round, tiedIds: s.voting.previous.tiedOptions });
      }
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

/** Ends the phase early once everyone who is required to act has acted (never while paused). */
function advanceIfReady(s: GameState, env: GameEnv): void {
  if (s.paused) return;
  switch (s.phase) {
    case "ROLE_REVEAL": {
      const here = s.players.filter((p) => p.connected);
      if (here.length > 0 && here.every((p) => p.ackedRole)) advance(s, env);
      break;
    }
    case "NIGHT":
      if (isNightComplete(s)) advance(s, env);
      break;
    case "DAY_DISCUSSION": {
      const talking = s.players.filter((p) => p.alive && p.connected && !p.kicked);
      if (talking.length > 0 && talking.every((p) => s.discussionDone.includes(p.id))) {
        addLog(s, { kind: "discussion_skipped", round: s.round, by: "players" });
        advance(s, env);
      }
      break;
    }
    case "VOTING": {
      // Everyone has voted: last call. Voting stays open a few more seconds (or until the timer,
      // if that is sooner), so votes can still change until the timer ends.
      if (!isVotingComplete(s)) break;
      const lastCall = env.now + VOTE_LAST_CALL_SECONDS * 1000;
      if (s.phaseEndsAt !== null && s.phaseEndsAt > lastCall) s.phaseEndsAt = lastCall;
      break;
    }
    default:
      break;
  }
}
