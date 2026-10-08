import type {
  Avatar,
  DeathCause,
  GameError,
  GameSettings,
  Phase,
  Role,
  VoteOutcome,
  Winner,
} from "@mafia/shared";
import type { Rng } from "./rng.js";

/**
 * The whole game, as plain JSON-safe data (no Maps, Sets or classes).
 * This is server-only: clients only ever see what getGameView() projects from it.
 */
export interface GameState {
  phase: Phase;
  settings: GameSettings;
  hostId: string | null;
  /** In join order. */
  players: PlayerState[];
  /** People who joined while a game was running; they become players at the next game. */
  spectators: SpectatorState[];
  /** Night/day cycle number; 0 until the first night starts. */
  round: number;
  /** Epoch ms at which the current phase times out, or null (lobby, game over). */
  phaseEndsAt: number | null;
  night: NightState;
  /** Only set during VOTING. */
  voting: VotingState | null;
  nightReport: NightReport | null;
  voteReport: VoteReport | null;
  lovers: [string, string] | null;
  /** Who the Doctor protected last night (cannot be protected again). */
  doctorLastProtectedId: string | null;
  investigations: Investigation[];
  mafiaCount: number;
  /** One entry per round, kept for the game-over timeline (never sent before then). */
  history: RoundLog[];
  /** Decided when a result is announced; takes effect when that results phase ends. */
  pendingWinner: Winner | null;
  winner: Winner | null;
}

export interface PlayerState {
  id: string;
  name: string;
  avatar: Avatar;
  role: Role | null;
  alive: boolean;
  connected: boolean;
  ackedRole: boolean;
  /** Removed by the host mid-game: out of the game, but kept in the list. */
  kicked: boolean;
}

export interface SpectatorState {
  id: string;
  name: string;
  avatar: Avatar;
  connected: boolean;
}

export interface NightState {
  /** Mafia member id -> target id. */
  mafiaVotes: Record<string, string>;
  protect: string | null;
  investigate: string | null;
  guard: string | null;
  link: [string, string] | null;
}

export interface RoundSummary {
  round: 1 | 2;
  ballots: Record<string, string>;
  tally: Record<string, number>;
}

export interface VotingState {
  round: 1 | 2;
  /** null = every living player; set in the revote. */
  candidates: string[] | null;
  /** voter id -> player id or SKIP. */
  ballots: Record<string, string>;
  previous: (RoundSummary & { tiedOptions: string[] }) | null;
}

export interface DeathRecord {
  playerId: string;
  cause: DeathCause;
}

export interface NightReport {
  round: number;
  deaths: DeathRecord[];
}

export interface VoteReport extends RoundSummary {
  outcome: VoteOutcome;
  deaths: DeathRecord[];
}

export interface NightLog {
  mafiaTargetId: string | null;
  protectedId: string | null;
  guardedId: string | null;
  linkedIds: [string, string] | null;
  investigation: { targetId: string; isMafia: boolean } | null;
  outcome: "no_attack" | "saved" | "guarded" | "killed";
  deaths: DeathRecord[];
}

export interface RoundLog {
  round: number;
  night: NightLog;
  vote: { outcome: VoteOutcome; tally: Record<string, number>; deaths: DeathRecord[] } | null;
}

export interface Investigation {
  round: number;
  targetId: string;
  isMafia: boolean;
}

export type GameAction =
  /** In the lobby you join as a player; while a game is running, as a spectator. */
  | { type: "JOIN"; playerId: string; name: string; avatar: Avatar }
  | { type: "LEAVE"; playerId: string }
  | { type: "DISCONNECT"; playerId: string }
  | { type: "RECONNECT"; playerId: string }
  | { type: "UPDATE_SETTINGS"; playerId: string; settings: unknown }
  | { type: "UPDATE_PROFILE"; playerId: string; name?: string; avatar?: Avatar }
  | { type: "KICK"; playerId: string; targetId: string }
  | { type: "TRANSFER_HOST"; playerId: string; targetId: string }
  | { type: "START_GAME"; playerId: string }
  | { type: "ACK_ROLE"; playerId: string }
  | { type: "NIGHT_ACTION"; playerId: string; targetId: string; secondTargetId?: string }
  | { type: "CAST_VOTE"; playerId: string; targetId: string }
  /** Sent by the server's timer; advances the phase if its deadline has passed. */
  | { type: "TICK" }
  | { type: "RESTART"; playerId: string };

export interface GameContext {
  /** Current time in epoch ms (supplied by the caller so the engine stays pure). */
  now: number;
  /** Random source; defaults to a cryptographic one. Pass a seeded one in tests. */
  rng?: Rng;
}

/** Context with defaults filled in, used internally. */
export interface GameEnv {
  now: number;
  rng: Rng;
}

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: GameError };
