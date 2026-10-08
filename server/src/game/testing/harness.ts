import type { Avatar, GameErrorCode, Phase, Role, SettingsPatch } from "@mafia/shared";
import { applyAction, createLobby, mulberry32, type GameAction, type GameState, type Rng } from "../index.js";

/** A tiny stateful wrapper around the pure engine, for readable tests. */
export class Game {
  state: GameState = createLobby();
  now = 1_000_000;
  readonly rng: Rng;

  constructor(seed = 1) {
    this.rng = mulberry32(seed);
  }

  get phase(): Phase {
    return this.state.phase;
  }

  send(action: GameAction) {
    const result = applyAction(this.state, action, { now: this.now, rng: this.rng });
    if (result.ok) this.state = result.state;
    return result;
  }

  /** Sends an action that must succeed. */
  ok(action: GameAction): void {
    const result = this.send(action);
    if (!result.ok) throw new Error(`${action.type} failed: ${result.error.code} (${result.error.message})`);
  }

  /** Sends an action that must be rejected and returns the error code. */
  fail(action: GameAction): GameErrorCode {
    const before = this.state;
    const result = this.send(action);
    if (result.ok) throw new Error(`${action.type} unexpectedly succeeded`);
    if (this.state !== before) throw new Error("a rejected action changed the state");
    return result.error.code;
  }

  /** Jumps to the end of the current phase and ticks. */
  endPhase(): void {
    if (this.state.phaseEndsAt === null) throw new Error(`phase ${this.phase} has no timer`);
    this.now = Math.max(this.now, this.state.phaseEndsAt);
    this.ok({ type: "TICK" });
  }

  /** Ends phases until `phase` is reached (fails if the game ends first). */
  advanceTo(phase: Phase): void {
    for (let i = 0; i < 12; i++) {
      if (this.phase === phase) return;
      if (this.phase === "GAME_OVER") throw new Error(`game ended before reaching ${phase}`);
      this.endPhase();
    }
    throw new Error(`never reached ${phase} (stuck in ${this.phase})`);
  }

  player(id: string) {
    const p = this.state.players.find((x) => x.id === id);
    if (!p) throw new Error(`no player ${id}`);
    return p;
  }

  nightAct(actor: string, target: string, second?: string): void {
    this.ok({ type: "NIGHT_ACTION", playerId: actor, targetId: target, secondTargetId: second });
  }

  vote(voter: string, target: string): void {
    this.ok({ type: "CAST_VOTE", playerId: voter, targetId: target });
  }

  /** Test shortcut: mark players dead without playing the rounds. */
  kill(...ids: string[]): void {
    for (const id of ids) this.player(id).alive = false;
  }
}

export const AVATAR: Avatar = { color: "teal", seed: "fox" };

export function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

/** A lobby with players p1..pn (p1 is the host). */
export function lobby(n: number, seed = 1): Game {
  const g = new Game(seed);
  for (const id of ids(n)) g.ok({ type: "JOIN", playerId: id, name: `Player ${id.slice(1)}`, avatar: AVATAR });
  return g;
}

/**
 * A running game in the first NIGHT where p1..pn have exactly the given roles
 * (the real random dealing is covered separately in roles.test.ts).
 */
export function gameWithRoles(roles: Role[], opts: { seed?: number; settings?: SettingsPatch } = {}): Game {
  const g = lobby(roles.length, opts.seed ?? 1);
  if (opts.settings) g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: opts.settings });
  g.ok({ type: "START_GAME", playerId: "p1" });
  g.state.players.forEach((p, i) => {
    p.role = roles[i] ?? "villager";
  });
  g.state.mafiaCount = roles.filter((r) => r === "mafia").length;
  g.endPhase(); // ROLE_REVEAL -> NIGHT
  return g;
}

/** Plays out a night: performs the actions, then lets the timer end it if it hasn't ended already. */
export function runNight(g: Game, acts: Array<[actor: string, target: string]>): void {
  for (const [actor, target] of acts) g.nightAct(actor, target);
  if (g.phase === "NIGHT") g.endPhase();
}

/** Has each listed voter vote; everyone else abstains. Ends the ballot via the timer if needed. */
export function runVote(g: Game, ballots: Record<string, string>): void {
  for (const [voter, target] of Object.entries(ballots)) g.vote(voter, target);
  if (g.phase === "VOTING" && g.state.voting?.round === 1) g.endPhase();
}

const M: Role = "mafia";
const V: Role = "villager";
/** 7 players: p1 mafia, p2 doctor, p3 detective, p4–p7 villagers. */
export const R7: Role[] = [M, "doctor", "detective", V, V, V, V];
/** 8 players, two Mafia: p1, p2 mafia, p3 doctor, p4 detective, p5–p8 villagers. */
export const R8: Role[] = [M, M, "doctor", "detective", V, V, V, V];
/** 12 players, three Mafia. */
export const R12: Role[] = [M, M, M, "doctor", "detective", V, V, V, V, V, V, V];
