/**
 * Game vocabulary shared by the server and the client: roles, phases, settings
 * and the per-player "view" the server is allowed to send.
 */
import type { AvatarView } from "./identity.js";
import type { ChatFilter } from "./profanity.js";

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
/** Bots a host may add to one room (the room's player limit still applies). */
export const MAX_BOTS = 10;
/** Without solo practice, a game needs at least this many real (non-bot) players. */
export const MIN_HUMANS = 2;

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
   * How much the chat filter hides (see CHAT_FILTERS). Safe Mode is always
   * "strict", whatever is stored here (see effectiveChatFilter); in Normal Mode
   * the host picks, and only Normal Mode may be "uncensored".
   */
  chatFilter: ChatFilter;
  /** Whether players may use their own pictures as avatars, and whether the host approves each one first. */
  customAvatars: AvatarPolicy;
  /** Safe Mode only: call the Mafia "the Sneaky Gang" (see gangName). */
  sneakyGang: boolean;
  /**
   * The host's browser writes the morning news and the vote results with Puter's
   * AI. Falls back to ready-made lines whenever that doesn't work out.
   */
  aiNarrator: boolean;
  /**
   * How bots play: "easy" picks mostly at random and misses most lies, "normal"
   * reasons from what it has seen and catches most lies, "hard" catches every
   * lie it can see and lies very consistently.
   */
  botDifficulty: BotDifficulty;
  /**
   * The host's browser (Puter's AI) writes the bots' messages in their own
   * styles and reads the public day chat for them. It is only ever sent public
   * information. Off: ready-made lines and a keyword reader.
   */
  aiBotChat: boolean;
  /** Allow a game with a single real player and bots (practice). Off: at least 2 real players. */
  soloPractice: boolean;
  /** When a real player joins a lobby that is full or at the size the host filled it to, a bot makes room. */
  replaceBots: boolean;
  /** A bot plays on for anyone who stays disconnected past the grace period, until they come back. */
  botTakeover: boolean;
}

export const BOT_DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

export interface SettingsPatch {
  contentMode?: ContentMode;
  mafiaCount?: number | "auto";
  optionalRoles?: Partial<Record<OptionalRole, boolean>>;
  timers?: Partial<TimerSettings>;
  tieRule?: TieRule;
  revealRoleOnDeath?: boolean;
  showVotes?: boolean;
  announceSaves?: boolean;
  chatFilter?: ChatFilter;
  customAvatars?: AvatarPolicy;
  sneakyGang?: boolean;
  aiNarrator?: boolean;
  botDifficulty?: BotDifficulty;
  aiBotChat?: boolean;
  soloPractice?: boolean;
  replaceBots?: boolean;
  botTakeover?: boolean;
}

/** What the Mafia are called in this game. "Sneaky Gang" is a Safe Mode option for younger players. */
export type GangName = "Mafia" | "Sneaky Gang";

export function gangName(settings: Pick<GameSettings, "contentMode" | "sneakyGang">): GangName {
  return settings.contentMode === "safe" && settings.sneakyGang ? "Sneaky Gang" : "Mafia";
}

/** Custom avatar pictures: not allowed, allowed, or allowed once the host has approved each one. */
export const AVATAR_POLICIES = ["off", "on", "approval"] as const;
export type AvatarPolicy = (typeof AVATAR_POLICIES)[number];

/** The chat filter that applies: always "strict" in Safe Mode, otherwise the host's choice. */
export function effectiveChatFilter(settings: Pick<GameSettings, "contentMode" | "chatFilter">): ChatFilter {
  return settings.contentMode === "safe" ? "strict" : settings.chatFilter;
}

/**
 * The settings a content mode starts with when the host switches to it: Safe
 * Mode filters chat strictly and has the host approve pictures; Normal Mode
 * uses the standard filter and shows pictures straight away.
 */
export function modeDefaults(mode: ContentMode): Pick<GameSettings, "chatFilter" | "customAvatars"> {
  return mode === "safe" ? { chatFilter: "strict", customAvatars: "approval" } : { chatFilter: "standard", customAvatars: "on" };
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
    ...modeDefaults("safe"),
    sneakyGang: false,
    aiNarrator: false,
    botDifficulty: "normal",
    aiBotChat: false,
    soloPractice: false,
    replaceBots: true,
    botTakeover: true,
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
  | "SPECTATOR"
  | "TIME_LIMIT";

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

/** Pausing, extra time and skipping the discussion: what a host may add, at most. */
export const ADD_TIME_SECONDS = 30;
/** A phase can't be stretched beyond this much time left. */
export const MAX_PHASE_REMAINING_SECONDS = 15 * 60;
/**
 * Once everyone has voted, voting stays open this much longer (or until the
 * timer, if that is sooner), so anyone can still change their mind.
 */
export const VOTE_LAST_CALL_SECONDS = 10;

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
  /** Everyone has voted: votes can still change until the (shortened) timer ends. */
  lastCall: boolean;
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

/** End-of-game highlights, worked out by the server (only sent once the game is over). */
export interface GameStatsView {
  /** Who survived longest: everyone still in the game at the end. */
  survivedLongest: { playerIds: string[] } | null;
  /** Of the players who left the game, who held on longest (and until when). Null if nobody left. */
  lastToLeave: { playerIds: string[]; round: number; part: "night" | "day" } | null;
  /**
   * The Town player who pointed at the Mafia most: votes cast against Mafia
   * members, plus the Detective's investigations that found one.
   */
  bestDetective: { playerIds: string[]; entries: { playerId: string; mafiaVotes: number; mafiaFound: number }[] } | null;
  /** The player whose votes went against innocent players most often. Null when votes were secret. */
  mostSuspiciousVoter: { playerIds: string[]; innocentVotes: number; totalVotes: number } | null;
  /** The host kept votes secret, so no stat reveals who voted for whom. */
  votesSecret: boolean;
}

/**
 * One line of the "What's happened so far" log during a game. Public events
 * only, the same for everyone: who left the game and how, vote results, and
 * the host's pauses and skips.
 */
export type LogEntryView =
  | { kind: "night"; round: number; deaths: DeathView[]; saved: boolean }
  | { kind: "vote"; round: number; outcome: VoteOutcome; deaths: DeathView[] }
  | { kind: "revote"; round: number; tiedIds: string[] }
  | { kind: "kicked"; round: number; playerId: string }
  | { kind: "paused" | "resumed" | "time_added"; round: number; phase: Phase }
  | { kind: "discussion_skipped"; round: number; by: "host" | "players" };

/** Day discussion: how many players are done talking (when everyone is, voting starts). */
export interface DiscussionView {
  doneCount: number;
  /** Living, connected players: all of them must be done for voting to start early. */
  needed: number;
  youAreDone: boolean;
}

export interface TimelineEntry {
  round: number;
  night: TimelineNight;
  vote: { outcome: VoteOutcome; tally: Record<string, number>; deaths: DeathView[] } | null;
}

/** Your own uploaded picture and where it stands. Pending pictures are seen only by you and the host. */
export interface YourPhotoView {
  id: string;
  status: "pending" | "approved";
}

export interface YouView {
  id: string;
  name: string;
  avatar: AvatarView;
  /** Your uploaded picture, if any (shown as `avatar.photo` to everyone once approved). */
  photo: YourPhotoView | null;
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
  avatar: AvatarView;
  alive: boolean;
  /** The game counts this player as present (online or reconnecting). */
  connected: boolean;
  connection: ConnectionStatus;
  isHost: boolean;
  /** Removed by the host during the game (shown as eliminated). */
  kicked: boolean;
  /** null unless public (reveal-on-death, or game over). */
  role: Role | null;
  /** Lobby: ready to play. Role-reveal: acknowledged. Voting: has voted. Never used at night. */
  done: boolean;
  /** A computer player the host added. Shown with a "Bot" label everywhere. */
  isBot: boolean;
  /** A real player who is away: a bot is playing for them until they come back. */
  botPlaying: boolean;
}

export interface SpectatorView {
  id: string;
  name: string;
  avatar: AvatarView;
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
  /** End-of-game highlights; null until the game is over. */
  stats: GameStatsView | null;
  /** Counts the games played in this room (1 for the first); private notes are kept per game. */
  gameNumber: number;
  /** Set while the host has paused the game: the timer is frozen with this much left. */
  paused: { remainingMs: number } | null;
  /** Day discussion only. */
  discussion: DiscussionView | null;
  /** Public events so far in this game (empty in the lobby). */
  log: LogEntryView[];
  /** Host only: pictures waiting for approval (empty for everyone else). */
  avatarRequests: { playerId: string; photo: string }[];
}
