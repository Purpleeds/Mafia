/**
 * Game vocabulary shared by the server and the client: roles, phases, settings
 * and the per-player "view" the server is allowed to send.
 */

// ---------------------------------------------------------------- roles

export const ROLES = ["mafia", "doctor", "detective", "villager", "jester", "bodyguard", "cupid"] as const;
export type Role = (typeof ROLES)[number];

/** Roles the host can switch on (at most one player each). */
export const OPTIONAL_ROLES = ["jester", "bodyguard", "cupid"] as const;
export type OptionalRole = (typeof OPTIONAL_ROLES)[number];

export type Team = "town" | "mafia" | "neutral";

export function teamOf(role: Role): Team {
  if (role === "mafia") return "mafia";
  if (role === "jester") return "neutral";
  return "town";
}

export type NightActionKind = "kill" | "protect" | "investigate" | "guard" | "link";

// ---------------------------------------------------------------- phases

export const PHASES = [
  "LOBBY",
  "ROLE_REVEAL",
  "NIGHT",
  "NIGHT_RESULTS",
  "DAY_DISCUSSION",
  "VOTING",
  "VOTE_RESULTS",
  "GAME_OVER",
] as const;
export type Phase = (typeof PHASES)[number];

export const CONTENT_MODES = ["safe", "normal"] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

export const TIE_RULES = ["no_elimination", "revote"] as const;
export type TieRule = (typeof TIE_RULES)[number];

export type Winner = "town" | "mafia" | "jester";
export type DeathCause = "mafia" | "vote" | "heartbreak";
export type VoteOutcome = "eliminated" | "skipped" | "tie" | "nobody";

export type ChatChannel = "public" | "mafia" | "graveyard";

/** The ballot value for "I don't want to eliminate anyone". */
export const SKIP = "skip";

// ---------------------------------------------------------------- limits

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 20;
export const MAX_PLAYER_NAME_LENGTH = 20;

/** Roughly one Mafia per four players, at least one. */
export function defaultMafiaCount(playerCount: number): number {
  return Math.max(1, Math.floor(playerCount / 4));
}

/** The host may raise the Mafia count, but never above a third of the players. */
export function maxMafiaCount(playerCount: number): number {
  return Math.max(1, Math.floor(playerCount / 3));
}

// ---------------------------------------------------------------- settings

export interface TimerSettings {
  roleRevealSeconds: number;
  nightSeconds: number;
  nightResultsSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  voteResultsSeconds: number;
}

export interface GameSettings {
  contentMode: ContentMode;
  /** "auto" = roughly one per four players. */
  mafiaCount: number | "auto";
  optionalRoles: Record<OptionalRole, boolean>;
  timers: TimerSettings;
  tieRule: TieRule;
  /** Show a player's role to everyone when they are eliminated. */
  revealRoleOnDeath: boolean;
}

export interface SettingsPatch {
  contentMode?: ContentMode;
  mafiaCount?: number | "auto";
  optionalRoles?: Partial<Record<OptionalRole, boolean>>;
  timers?: Partial<TimerSettings>;
  tieRule?: TieRule;
  revealRoleOnDeath?: boolean;
}

export const TIMER_LIMITS: Record<keyof TimerSettings, { min: number; max: number }> = {
  roleRevealSeconds: { min: 5, max: 30 },
  nightSeconds: { min: 10, max: 120 },
  nightResultsSeconds: { min: 3, max: 30 },
  discussionSeconds: { min: 15, max: 600 },
  votingSeconds: { min: 10, max: 180 },
  voteResultsSeconds: { min: 3, max: 30 },
};

export const MAX_MAFIA_SETTING = maxMafiaCount(MAX_PLAYERS);

export function defaultSettings(): GameSettings {
  return {
    contentMode: "safe",
    mafiaCount: "auto",
    optionalRoles: { jester: false, bodyguard: false, cupid: false },
    timers: {
      roleRevealSeconds: 10,
      nightSeconds: 30,
      nightResultsSeconds: 10,
      discussionSeconds: 120,
      votingSeconds: 45,
      voteResultsSeconds: 10,
    },
    tieRule: "no_elimination",
    revealRoleOnDeath: true,
  };
}

// ---------------------------------------------------------------- errors

export type GameErrorCode =
  | "WRONG_PHASE"
  | "NOT_HOST"
  | "NOT_IN_GAME"
  | "INVALID_ID"
  | "ALREADY_JOINED"
  | "ROOM_FULL"
  | "INVALID_NAME"
  | "NAME_TAKEN"
  | "INVALID_SETTINGS"
  | "NOT_ENOUGH_PLAYERS"
  | "TOO_MANY_ROLES"
  | "DEAD_PLAYER"
  | "NO_ABILITY"
  | "INVALID_TARGET"
  | "REPEAT_PROTECTION";

export interface GameError {
  code: GameErrorCode;
  message: string;
}

// ---------------------------------------------------------------- views
// Everything below is what a single player may be told. The server builds it
// with getGameView(); nothing else about the game state is ever sent.

export interface DeathView {
  playerId: string;
  cause: DeathCause;
  /** Only set when the role is public (reveal-on-death setting, or game over). */
  role: Role | null;
}

export interface NightReportView {
  round: number;
  deaths: DeathView[];
}

export interface VoteRoundSummaryView {
  round: 1 | 2;
  /** voter id -> player id or SKIP. Players who did not vote are absent. */
  ballots: Record<string, string>;
  /** option -> votes. Players who did not vote count as SKIP. */
  tally: Record<string, number>;
}

export interface VoteReportView extends VoteRoundSummaryView {
  outcome: VoteOutcome;
  deaths: DeathView[];
}

export interface VotingView {
  round: 1 | 2;
  /** null = every living player; set during a revote. */
  candidateIds: string[] | null;
  /** The tied first round, shown during a revote. */
  previous: (VoteRoundSummaryView & { tiedOptions: string[] }) | null;
  validTargetIds: string[];
  myBallot: string | null;
}

export interface NightActionView {
  kind: NightActionKind;
  validTargetIds: string[];
  /** What this player has chosen so far (two ids for "link"). */
  picks: string[];
  /** Mafia only: what the Mafia teammates have voted for so far. */
  teammateVotes: Record<string, string> | null;
}

export interface InvestigationView {
  round: number;
  targetId: string;
  isMafia: boolean;
}

export interface YouView {
  id: string;
  name: string;
  role: Role | null;
  alive: boolean;
  isHost: boolean;
  /** Other Mafia members (Mafia only). */
  teammateIds: string[];
  /** The linked pair (visible to Cupid, the lovers, and everyone at game over). */
  loverIds: [string, string] | null;
  /** Detective only. */
  investigations: InvestigationView[];
  nightAction: NightActionView | null;
}

export interface PublicPlayerView {
  id: string;
  name: string;
  alive: boolean;
  connected: boolean;
  isHost: boolean;
  /** null unless public (reveal-on-death, or game over). */
  role: Role | null;
  /** Role-reveal: acknowledged. Voting: has voted. Never used at night. */
  done: boolean;
}

export interface GameView {
  phase: Phase;
  settings: GameSettings;
  hostId: string | null;
  round: number;
  /** Epoch ms when the current phase ends, or null if it has no timer. */
  phaseEndsAt: number | null;
  /** Total Mafia in this game (0 in the lobby). */
  mafiaCount: number;
  players: PublicPlayerView[];
  you: YouView | null;
  nightReport: NightReportView | null;
  voteReport: VoteReportView | null;
  voting: VotingView | null;
  winner: Winner | null;
  /** Game over only. */
  winnerIds: string[];
}
