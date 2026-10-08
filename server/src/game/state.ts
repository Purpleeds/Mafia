import { defaultSettings, type GameSettings } from "@mafia/shared";
import type { GameState, NightState, PlayerState, SpectatorState } from "./types.js";

export function emptyNight(): NightState {
  return { mafiaVotes: {}, protect: null, investigate: null, guard: null, link: null };
}

/** A fresh, empty lobby. The first player to JOIN becomes the host. */
export function createLobby(settings: GameSettings = defaultSettings()): GameState {
  return {
    phase: "LOBBY",
    settings,
    hostId: null,
    players: [],
    spectators: [],
    round: 0,
    phaseEndsAt: null,
    night: emptyNight(),
    voting: null,
    nightReport: null,
    voteReport: null,
    lovers: null,
    doctorLastProtectedId: null,
    investigations: [],
    mafiaCount: 0,
    history: [],
    pendingWinner: null,
    winner: null,
  };
}

export function findPlayer(state: GameState, id: string): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function findSpectator(state: GameState, id: string): SpectatorState | undefined {
  return state.spectators.find((p) => p.id === id);
}

/** A player or a spectator. */
export function findMember(state: GameState, id: string): PlayerState | SpectatorState | undefined {
  return findPlayer(state, id) ?? findSpectator(state, id);
}

export function livingPlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

/** Own-property check, safe for ids like "constructor". */
export function has(record: object, key: string): boolean {
  return Object.hasOwn(record, key);
}

/** Clears everything that belongs to one game, keeping players and settings. */
export function resetGameData(state: GameState): void {
  state.round = 0;
  state.night = emptyNight();
  state.voting = null;
  state.nightReport = null;
  state.voteReport = null;
  state.lovers = null;
  state.doctorLastProtectedId = null;
  state.investigations = [];
  state.mafiaCount = 0;
  state.history = [];
  state.pendingWinner = null;
  state.winner = null;
  state.phaseEndsAt = null;
  for (const p of state.players) {
    p.role = null;
    p.alive = true;
    p.ackedRole = false;
    p.kicked = false;
  }
}
