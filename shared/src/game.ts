/**
 * Game vocabulary shared by the server and the client: roles, phases, settings
 * and the per-player "view" the server is allowed to send.
 */
import type { Avatar } from "./identity.js";

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
/** Late joiners watch until the next game. */
export const MAX_SPECTATORS = 20;

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
  /** Show who voted for whom (live, and in the results). Vote counts are always shown. */
  showVotes: boolean;
  /** Tell everyone when the Doctor saved someone (without saying who). */
  announceSaves: boolean;
  /**
   * Mask rude words in chat. Always on in Safe Mode, whatever is stored here
   * (see isChatFiltered); in Normal Mode the host may turn it off.
   */
  profanityFilter: boolean;
  /** Safe Mode only: call the Mafia "the Sneaky Gang" (see gangName). */
  sneakyGang: boolean;
  /**
   * The host's browser writes the morning news and the vote results with Puter's
   * AI. Falls back to ready-made lines whenever that doesn't work out.
   */
  aiNarrator: boolean;
}

export interface SettingsPatch {
  contentMode?: ContentMode;
  mafiaCount?: number | "auto";
  optionalRoles?: Partial<Record<OptionalRole, boolean>>;
  timers?: Partial<TimerSettings>;
  tieRule?: TieRule;
  revealRoleOnDeath?: boolean;
  showVotes?: boolean;
  announceSaves?: boolean;
  profanityFilter?: boolean;
  sneakyGang?: boolean;
  aiNarrator?: boolean;
}

/** What the Mafia are called in this game. "Sneaky Gang" is a Safe Mode option for younger players. */
export type GangName = "Mafia" | "Sneaky Gang";

export function gangName(settings: Pick<GameSettings, "contentMode" | "sneakyGang">): GangName {
  return settings.contentMode === "safe" && settings.sneakyGang ? "Sneaky Gang" : "Mafia";
}

/** Whether chat is filtered: always in Safe Mode, otherwise the host's choice. */
export function isChatFiltered(settings: Pick<GameSettings, "contentMode" | "profanityFilter">): boolean {
  return settings.contentMode === "safe" || settings.profanityFilter;
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
    showVotes: true,
    announceSaves: true,
    profanityFilter: true,
    sneakyGang: false,
    aiNarrator: false,
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
  | "INVALID_AVATAR"
  | "NAME_TAKEN"
  | "INVALID_SETTINGS"
  | "NOT_ENOUGH_PLAYERS"
  | "TOO_MANY_ROLES"
  | "DEAD_PLAYER"
  | "NO_ABILITY"
  | "INVALID_TARGET"
  | "REPEAT_PROTECTION"
  | "SPECTATOR";

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
  /** The Doctor saved the Mafia's target. Only ever true when the host announces saves. */
  saved: boolean;
}

/**
 * The announcement after a night or a vote. The same for everyone (it only ever
 * holds public facts). While `status` is "thinking" the narrator is still
 * writing; `source` says whether the AI or a ready-made line wrote it.
 */
export interface NarrationView {
  kind: "night" | "vote";
  round: number;
  status: "thinking" | "ready";
  text: string | null;
  source: "ai" | "template" | null;
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

export interface LiveVotes {
  /** option (player id or SKIP) -> ballots cast so far. Always shown. */
  tally: Record<string, number>;
  /** voter id -> option; null when the host hides who voted for whom. */
  ballots: Record<string, string> | null;
}

export interface VotingView {
  /** Live counts while voting is open. */
  live: LiveVotes;
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

/** Chat channels this person may use right now (the server decides). */
export interface ChatAccess {
  write: ChatChannel[];
  read: ChatChannel[];
}

export interface TimelineNight {
  mafiaTargetId: string | null;
  protectedId: string | null;
  guardedId: string | null;
  /** Cupid's pair (first night). */
  linkedIds: [string, string] | null;
  investigation: { targetId: string; isMafia: boolean } | null;
  /** no_attack: the Mafia chose no one. saved: the Doctor protected the target. guarded: the Bodyguard took the hit. */
  outcome: "no_attack" | "saved" | "guarded" | "killed";
  deaths: DeathView[];
}

export interface TimelineEntry {
  round: number;
  night: TimelineNight;
  vote: { outcome: VoteOutcome; tally: Record<string, number>; deaths: DeathView[] } | null;
}

export interface YouView {
  id: string;
  name: string;
  avatar: Avatar;
  role: Role | null;
  alive: boolean;
  isHost: boolean;
  /** Joined while a game was running: watching until the next one. */
  isSpectator: boolean;
  /** Other Mafia members (Mafia only). */
  teammateIds: string[];
  /** The linked pair (visible to Cupid, the lovers, and everyone at game over). */
  loverIds: [string, string] | null;
  /** Detective only. */
  investigations: InvestigationView[];
  /** Doctor only: who you protected on the last night (your own choice). */
  protectedId: string | null;
  nightAction: NightActionView | null;
  chat: ChatAccess;
}

/**
 * online: connected. reconnecting: their connection dropped moments ago (e.g. a
 * locked phone) and they still count as present. offline: gone for longer.
 */
export type ConnectionStatus = "online" | "reconnecting" | "offline";

export interface PublicPlayerView {
  id: string;
  name: string;
  avatar: Avatar;
  alive: boolean;
  /** The game counts this player as present (online or reconnecting). */
  connected: boolean;
  connection: ConnectionStatus;
  isHost: boolean;
  /** Removed by the host during the game (shown as eliminated). */
  kicked: boolean;
  /** null unless public (reveal-on-death, or game over). */
  role: Role | null;
  /** Role-reveal: acknowledged. Voting: has voted. Never used at night. */
  done: boolean;
}

export interface SpectatorView {
  id: string;
  name: string;
  avatar: Avatar;
  connected: boolean;
  connection: ConnectionStatus;
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
  spectators: SpectatorView[];
  you: YouView | null;
  nightReport: NightReportView | null;
  voteReport: VoteReportView | null;
  /** The latest morning news or vote result, from the narrator. */
  narration: NarrationView | null;
  voting: VotingView | null;
  winner: Winner | null;
  /** Game over only. */
  winnerIds: string[];
  /** What happened each round, including the secrets: game over only (empty before). */
  timeline: TimelineEntry[];
}
