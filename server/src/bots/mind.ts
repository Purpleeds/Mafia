/**
 * A bot's memory and judgement. Pure functions over what the bot is allowed to
 * know: its own personalised GameView (the same one a human in that seat
 * gets), the chat messages it could read, and what was said in the public chat
 * (heard events, the same for every bot). Nothing here can see another
 * player's role, the Mafia's target or anything else hidden.
 *
 * Each bot keeps a suspicion score for every other player and moves it, by its
 * own personality, with what it sees and hears:
 *  - a confident claim or accusation moves a gullible bot a lot and a stubborn
 *    one (that already suspects someone else) very little;
 *  - pointing at someone's real voting record counts for more than shouting,
 *    and a false one costs the speaker their credibility;
 *  - players who keep accusing without evidence slowly stop being believed;
 *  - every public claim goes in a ledger that is checked for contradictions
 *    (two players claiming the same role, a claim the revealed roles disprove,
 *    votes against someone's own words, a changed claim). A caught lie is a
 *    big jump in suspicion. Easy bots notice few, Hard bots all of them.
 */
import { SKIP, type BotDifficulty, type ChatMessage, type ContradictionKind, type GameView, type PublicPlayerView, type QuestionTopic, type Role } from "@mafia/shared";
import type { Heard } from "./heard.js";
import { hashUnit, type BotPersonality } from "./personality.js";

export type Random = () => number;

export interface RoleClaim {
  speakerId: string;
  role: Role;
  day: number;
  at: number;
}

export interface ResultClaim {
  speakerId: string;
  targetId: string;
  result: "mafia" | "innocent";
  night: number | null;
  day: number;
  at: number;
}

export interface Statement {
  speakerId: string;
  messageId: string;
  kind: "accuse" | "defend" | "vote_request";
  targetId: string;
  confident: boolean;
  day: number;
  at: number;
}

/** Two things that can't both be true, and who must be lying. */
export interface Contradiction {
  key: string;
  kind: ContradictionKind;
  liarId: string;
  /** The other player involved (the other claimer, the revealed player, who was voted). */
  aboutId: string | null;
  role: Role | null;
  /** Only this bot can know it (from its own role): saying so gives the role away. */
  private: boolean;
  day: number;
}

/** What this bot has said about itself in public: its "story" (kept consistent across days). */
export interface Story {
  role: Role | null;
  results: Array<{ targetId: string; result: "mafia" | "innocent"; night: number }>;
  /** The roles it has claimed, in order (a change is something others can catch). */
  claims: Role[];
}

/** Per-day speaking memory. */
export interface DayTalk {
  day: number;
  opened: boolean;
  allied: boolean;
  defendedTeam: boolean;
  voteSaid: string | null;
  lastDefenceAt: number;
  reveal: boolean | null;
  slipped: boolean;
  /** Shared a (real or pretend) Detective result today. */
  reported: boolean;
}

export interface Mind {
  game: number;
  day: number;
  /** How suspicious each player looks to this bot (higher = more likely Mafia). */
  suspicion: Record<string, number>;
  /** A small personal bias per player, so bots don't all think alike. */
  bias: Record<string, number>;
  /** Mafia bots: how much each player seems to be onto them or their team. */
  threat: Record<string, number>;
  /** Players this bot has come to trust (alliances, defending it). */
  trust: Record<string, number>;
  /** How much a speaker is believed (1 = normal). */
  credibility: Record<string, number>;
  /** Accusations each speaker made without any evidence. */
  unsupported: Record<string, number>;
  /** Who stood up for whom (or allied): if one turns out Mafia, the other looks worse. */
  links: Record<string, string[]>;
  roleClaims: RoleClaim[];
  resultClaims: ResultClaim[];
  statements: Statement[];
  /** Ballots of each finished vote this bot saw (empty when votes are secret). */
  ballots: Array<{ key: string; day: number; ballots: Record<string, string> }>;
  /** Roles made public when players left the game. */
  revealed: Record<string, Role>;
  /** Contradictions this bot noticed. */
  contradictions: Contradiction[];
  /** Contradiction keys already considered (noticed or missed: never rolled twice). */
  checked: string[];
  /** Contradictions someone has already pointed out in public. */
  calledOut: string[];
  /** Who people asked (or asked this bot) to vote for today. */
  voteRequests: Record<string, number>;
  /** Accusations against this bot today. */
  accusedMe: Array<{ speakerId: string; at: number; messageId: string; confident: boolean }>;
  /** Questions to this bot that it hasn't answered. */
  questions: Array<{ speakerId: string; about: QuestionTopic; at: number; messageId: string }>;
  /** Public messages this bot wrote (so it knows when someone answers it). */
  myMessages: string[];
  /** Messages that answered this bot, waiting for it to react. */
  repliesToMe: Array<{ speakerId: string; messageId: string; at: number }>;
  /** Statements it already agreed with or pushed back on today. */
  reactedTo: string[];
  heardKeys: string[];
  seenVotes: string[];
  seenReveals: string[];
  seenNights: string[];
  seenChat: string[];
  /** Mafia bots: the target a teammate suggested in the Mafia chat tonight. */
  teamSuggestion: { round: number; targetId: string; fromHuman: boolean } | null;
  story: Story;
  /** Detective results (real or invented) already said out loud. */
  announced: string[];
  /** Mafia bots: whether to pose as the Detective this game (decided once). */
  fakeDetective: boolean | null;
  /** Its recent lines, so it doesn't say the same thing twice. */
  said: string[];
  talk: DayTalk;
}

export function newMind(game = 0): Mind {
  return {
    game,
    day: 0,
    suspicion: {},
    bias: {},
    threat: {},
    trust: {},
    credibility: {},
    unsupported: {},
    links: {},
    roleClaims: [],
    resultClaims: [],
    statements: [],
    ballots: [],
    revealed: {},
    contradictions: [],
    checked: [],
    calledOut: [],
    voteRequests: {},
    accusedMe: [],
    questions: [],
    myMessages: [],
    repliesToMe: [],
    reactedTo: [],
    heardKeys: [],
    seenVotes: [],
    seenReveals: [],
    seenNights: [],
    seenChat: [],
    teamSuggestion: null,
    story: { role: null, results: [], claims: [] },
    announced: [],
    fakeDetective: null,
    said: [],
    talk: freshTalk(0),
  };
}

export function freshTalk(day: number): DayTalk {
  return { day, opened: false, allied: false, defendedTeam: false, voteSaid: null, lastDefenceAt: 0, reveal: null, slipped: false, reported: false };
}

export interface MindContext {
  view: GameView;
  personality: BotPersonality;
  difficulty: BotDifficulty;
  random: Random;
}

/** One-of-a-kind roles: two players claiming one of these means somebody is lying. */
export const UNIQUE_ROLES: readonly Role[] = ["doctor", "detective", "bodyguard", "cupid", "jester"];
const TOWN_ROLES: readonly Role[] = ["doctor", "detective", "villager", "bodyguard", "cupid"];
const clamp = (n: number) => Math.max(-80, Math.min(160, n));

export function bump(map: Record<string, number>, id: string, by: number): void {
  if (!Number.isFinite(by) || by === 0) return;
  map[id] = clamp((map[id] ?? 0) + by);
}

export function me(view: GameView): PublicPlayerView | undefined {
  return view.players.find((p) => p.id === view.you?.id);
}

export function living(view: GameView): PublicPlayerView[] {
  return view.players.filter((p) => p.alive && !p.kicked);
}

export function isAlive(view: GameView, id: string): boolean {
  return view.players.some((p) => p.id === id && p.alive && !p.kicked);
}

export function playerName(view: GameView, id: string | undefined): string | undefined {
  return id === undefined ? undefined : (view.players.find((p) => p.id === id)?.name ?? undefined);
}

/** Players named in a message (whole names, any case), not counting the sender. */
export function mentioned(view: GameView, text: string, senderId: string): string[] {
  const lower = text.toLowerCase();
  return view.players
    .filter((p) => p.id !== senderId && p.name.length >= 2)
    .filter((p) => {
      const name = p.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, "u").test(lower);
    })
    .map((p) => p.id);
}

// ---------------------------------------------------------------- judgement

/** How much this bot believes a speaker right now (about 0.15 to 1.6). */
export function credibility(mind: Mind, id: string): number {
  const base = mind.credibility[id] ?? 1;
  const noisy = Math.max(0, (mind.unsupported[id] ?? 0) - 2);
  return Math.max(0.15, Math.min(1.6, base * 0.9 ** noisy));
}

/** How suspicious a player looks right now to this bot, including what its own role learned. */
export function score(mind: Mind, view: GameView, id: string): number {
  const you = view.you;
  let s = (mind.suspicion[id] ?? 0) + (mind.bias[id] ?? 0) - (mind.trust[id] ?? 0) * 0.6;
  const found = you?.investigations.filter((i) => i.targetId === id) ?? [];
  if (found.some((i) => i.isMafia)) s += 200;
  else if (found.length > 0) s -= 80;
  if (you?.loverIds?.includes(id) && you.loverIds.includes(you.id)) s -= 100;
  return s;
}

/** How much the town is on someone today: accusers, vote requests and live votes (all public). */
export function heat(mind: Mind, view: GameView, id: string): number {
  const accusers = new Set(
    mind.statements
      .filter((s) => s.day === mind.day && s.targetId === id && s.kind !== "defend" && s.speakerId !== id)
      .map((s) => s.speakerId),
  );
  const votes = view.voting?.live.tally[id] ?? 0;
  return accusers.size * 4 + votes * 3;
}

/** The player this bot suspects most (a Mafia bot: the best scapegoat), among those still in. */
export function topSuspect(mind: Mind, view: GameView, random: Random, jitter = 4): string | undefined {
  const you = view.you;
  if (!you) return undefined;
  const team = new Set(you.teammateIds);
  const pool = living(view).filter((p) => p.id !== you.id && !team.has(p.id));
  const value = (id: string) =>
    you.role === "mafia" ? score(mind, view, id) + heat(mind, view, id) * 1.5 + (mind.threat[id] ?? 0) : score(mind, view, id);
  return best(
    pool.map((p) => p.id),
    value,
    random,
    jitter,
  );
}

export function best(ids: readonly string[], value: (id: string) => number, random: Random, jitter = 6): string | undefined {
  let top: string | undefined;
  let topValue = -Infinity;
  for (const id of ids) {
    const v = value(id) + (random() - 0.5) * jitter;
    if (v > topValue) {
      topValue = v;
      top = id;
    }
  }
  return top;
}

/** Players whose latest claim is this role (and who haven't been caught lying about it). */
export function claimers(mind: Mind, role: Role): string[] {
  const latest = new Map<string, Role>();
  for (const c of mind.roleClaims) latest.set(c.speakerId, c.role);
  const liars = new Set(mind.contradictions.map((c) => c.liarId));
  return [...latest.entries()].filter(([id, r]) => r === role && !liars.has(id)).map(([id]) => id);
}

/**
 * How hard this bot resists changing its mind. A stubborn bot that already
 * suspects someone else barely moves; verified evidence gets through better.
 */
function resist(mind: Mind, ctx: MindContext, targetId: string, raising: boolean, strong: boolean): number {
  const s = ctx.personality.stubbornness;
  const top = topSuspect(mind, ctx.view, () => 0.5, 0);
  const opinionated = top !== undefined && score(mind, ctx.view, top) >= 10;
  const against = opinionated && (raising ? top !== targetId : top === targetId);
  if (!against) return 1 - 0.35 * s;
  return 1 - (strong ? 0.55 : 0.92) * s;
}

const gullible = (p: BotPersonality) => 0.25 + 1.5 * p.gullibility;

/** Did `about` vote for `votedFor` in a vote this bot saw? null if it can't tell (secret votes, or before it joined). */
export function votedFor(mind: Mind, about: string, target: string): boolean | null {
  const rounds = mind.ballots.filter((b) => Object.keys(b.ballots).length > 0);
  if (rounds.length === 0) return null;
  if (rounds.some((b) => b.ballots[about] === target)) return true;
  return rounds.some((b) => b.ballots[about] !== undefined) ? false : null;
}

function link(mind: Mind, a: string, b: string): void {
  if (a === b) return;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const list = (mind.links[x] ??= []);
    if (!list.includes(y)) list.push(y);
  }
}

function startDay(mind: Mind, view: GameView): void {
  if (view.round === mind.day) return;
  mind.day = view.round;
  mind.voteRequests = {};
  mind.accusedMe = [];
  mind.reactedTo = [];
  mind.repliesToMe = [];
  mind.talk = freshTalk(view.round);
}

// ---------------------------------------------------------------- what the bot sees

/**
 * Takes in everything new in the bot's view and chat: finished votes, roles
 * revealed when players left, who was taken in the night, and (Mafia) a
 * teammate's suggestion in the Mafia chat. Returns how many contradictions it
 * newly noticed.
 */
export function observe(mind: Mind, ctx: MindContext, chat: readonly ChatMessage[]): number {
  const { view, random } = ctx;
  const you = view.you;
  if (!you) return 0;
  if (mind.game !== view.gameNumber) Object.assign(mind, newMind(view.gameNumber));
  startDay(mind, view);
  const myId = you.id;
  const team = new Set(you.teammateIds);
  const innocentMe = you.role !== null && you.role !== "mafia";
  const jitter = ctx.difficulty === "hard" ? 3 : ctx.difficulty === "easy" ? 10 : 7;

  for (const p of view.players) {
    if (p.id === myId) continue;
    if (mind.bias[p.id] === undefined) mind.bias[p.id] = (random() - 0.5) * jitter;
    if (mind.suspicion[p.id] === undefined) mind.suspicion[p.id] = 0;
  }

  // Votes, once each round, when the host shows who voted for whom.
  const report = view.voteReport;
  const voteKey = report ? `${view.gameNumber}:${view.round}:${report.round}` : null;
  if (report && voteKey && !mind.seenVotes.includes(voteKey)) {
    mind.seenVotes.push(voteKey);
    const ballots = report.ballots;
    if (Object.keys(ballots).length > 0) mind.ballots.push({ key: voteKey, day: view.round, ballots: { ...ballots } });
    for (const [voter, target] of Object.entries(ballots)) {
      if (voter === myId || target === SKIP) continue;
      if (target === myId && innocentMe) bump(mind.suspicion, voter, 10);
      if (team.has(target) || target === myId) bump(mind.threat, voter, 10);
      const role = view.players.find((p) => p.id === target)?.role;
      if (role === "mafia") bump(mind.suspicion, voter, -12);
      else if (role && TOWN_ROLES.includes(role)) bump(mind.suspicion, voter, 8);
    }
    voteMismatches(mind, ctx, ballots);
  }

  // Roles revealed when players leave (if the host shows them): judge past words and votes by them.
  for (const p of view.players) {
    if (p.alive || !p.role || mind.seenReveals.includes(p.id)) continue;
    mind.seenReveals.push(p.id);
    mind.revealed[p.id] = p.role;
    const mafia = p.role === "mafia";
    for (const round of mind.ballots) {
      const theirPick = round.ballots[p.id];
      for (const [voter, target] of Object.entries(round.ballots)) {
        if (voter === myId || voter === p.id) continue;
        if (mafia) {
          if (target === p.id) bump(mind.suspicion, voter, -6);
          // Voted exactly like a Mafia member: maybe their teammate.
          else if (theirPick && theirPick !== SKIP && target === theirPick) bump(mind.suspicion, voter, 8);
        } else if (target === p.id) {
          bump(mind.suspicion, voter, 5);
        }
      }
    }
    for (const s of mind.statements) {
      if (s.targetId !== p.id || s.speakerId === myId) continue;
      if (s.kind === "accuse" || s.kind === "vote_request") {
        mind.credibility[s.speakerId] = (mind.credibility[s.speakerId] ?? 1) + (mafia ? 0.25 : s.confident ? -0.1 : 0);
      } else if (s.kind === "defend" && mafia && !team.has(s.speakerId)) {
        bump(mind.suspicion, s.speakerId, 10);
      }
    }
    for (const other of mind.links[p.id] ?? []) {
      if (other === myId || team.has(other)) continue;
      bump(mind.suspicion, other, mafia ? 12 : -4);
    }
  }

  // Taken in the night: they were innocent, so whoever they accused looks worse.
  const night = view.nightReport;
  const nightKey = night ? `${view.gameNumber}:${night.round}` : null;
  if (night && nightKey && !mind.seenNights.includes(nightKey)) {
    mind.seenNights.push(nightKey);
    for (const death of night.deaths) {
      if (death.cause !== "mafia") continue;
      for (const s of mind.statements) {
        if (s.speakerId === death.playerId && s.kind === "accuse" && s.targetId !== myId) bump(mind.suspicion, s.targetId, 6);
      }
    }
  }

  // The Mafia chat (Mafia bots only ever see it): a teammate's suggestion for tonight.
  for (const message of chat) {
    if (mind.seenChat.includes(message.id)) continue;
    mind.seenChat.push(message.id);
    if (message.channel !== "mafia" || message.senderId === myId || message.reaction) continue;
    const target = mentioned(view, message.text, message.senderId).find((t) => !team.has(t) && t !== myId);
    if (target) {
      const fromHuman = !view.players.find((p) => p.id === message.senderId)?.isBot;
      mind.teamSuggestion = { round: view.round, targetId: target, fromHuman };
    }
  }
  if (mind.seenChat.length > 400) mind.seenChat = mind.seenChat.slice(-300);

  return checkContradictions(mind, ctx);
}

/** After a vote: someone who said one thing about a player and voted the other way. */
function voteMismatches(mind: Mind, ctx: MindContext, ballots: Record<string, string>): void {
  const day = ctx.view.round;
  for (const [voter, choice] of Object.entries(ballots)) {
    // The strongest thing each voter said today about one player.
    const results = mind.resultClaims.filter((r) => r.speakerId === voter && r.day === day && r.result === "mafia");
    const requests = mind.statements.filter((s) => s.speakerId === voter && s.day === day && s.kind === "vote_request");
    const named = results.at(-1)?.targetId ?? requests.at(-1)?.targetId;
    if (named && named !== SKIP && choice !== named && ballots[named] !== undefined) {
      remember(mind, ctx, {
        key: `vote_mismatch:${voter}:${day}:${named}`,
        kind: "vote_mismatch",
        liarId: voter,
        aboutId: named,
        role: null,
        private: false,
        day,
      }, 10);
    }
    const defended = mind.statements.filter((s) => s.speakerId === voter && s.day === day && s.kind === "defend" && s.targetId !== voter);
    const vouched = defended.find((s) => s.targetId === choice);
    if (vouched) {
      remember(mind, ctx, {
        key: `vote_mismatch:${voter}:${day}:${choice}:defended`,
        kind: "vote_mismatch",
        liarId: voter,
        aboutId: choice,
        role: null,
        private: false,
        day,
      }, 10);
    }
  }
}

// ---------------------------------------------------------------- what the bot hears

export interface HearResult {
  /** Someone asked this bot something. */
  questioned: boolean;
  /** Someone accused this bot. */
  accused: boolean;
  /** Someone answered one of this bot's messages. */
  answered: boolean;
  /** It noticed a new contradiction. */
  noticed: boolean;
  /** Something that could change its vote. */
  persuaded: boolean;
}

function heardKey(ev: Heard): string {
  const { messageId, speakerId, at, byBot, replyTo, ...rest } = ev;
  void at;
  void byBot;
  void replyTo;
  return `${messageId}:${speakerId}:${JSON.stringify(rest)}`;
}

/** The bot's own public words become its story (what it has claimed), so it stays consistent. */
function rememberOwn(mind: Mind, ev: Heard): void {
  if (!mind.myMessages.includes(ev.messageId)) mind.myMessages.push(ev.messageId);
  if (ev.kind === "role_claim") {
    mind.story.role = ev.role;
    if (mind.story.claims.at(-1) !== ev.role) mind.story.claims.push(ev.role);
  }
  if (ev.kind === "result_claim") {
    if (!mind.story.results.some((r) => r.targetId === ev.targetId)) {
      mind.story.results.push({ targetId: ev.targetId, result: ev.result, night: ev.night ?? mind.day });
    }
    if (!mind.announced.includes(ev.targetId)) mind.announced.push(ev.targetId);
  }
  if (ev.kind === "call_out") mind.calledOut.push(contradictionKey(ev.contradiction, ev.targetId, ev.aboutId));
}

export function contradictionKey(kind: ContradictionKind, liar: string, about: string | null): string {
  return `${kind}:${liar}:${about ?? ""}`;
}

/**
 * Takes in what players said in the public chat. Weighs each statement by the
 * speaker's credibility and this bot's personality.
 */
export function hear(mind: Mind, ctx: MindContext, events: readonly Heard[]): HearResult {
  const result: HearResult = { questioned: false, accused: false, answered: false, noticed: false, persuaded: false };
  const { view, personality: p } = ctx;
  const you = view.you;
  if (!you) return result;
  if (mind.game !== view.gameNumber) Object.assign(mind, newMind(view.gameNumber));
  startDay(mind, view);
  const myId = you.id;
  const team = new Set(you.teammateIds);
  const innocentMe = you.role !== null && you.role !== "mafia";
  const g = gullible(p);
  const day = mind.day;

  for (const ev of events) {
    const k = heardKey(ev);
    if (mind.heardKeys.includes(k)) continue;
    mind.heardKeys.push(k);
    if (ev.speakerId === myId) {
      rememberOwn(mind, ev);
      continue;
    }
    if (ev.replyTo && mind.myMessages.includes(ev.replyTo)) {
      result.answered = true;
      mind.repliesToMe.push({ speakerId: ev.speakerId, messageId: ev.messageId, at: ev.at });
    }
    const speaker = ev.speakerId;
    const cred = credibility(mind, speaker);

    switch (ev.kind) {
      case "role_claim": {
        mind.roleClaims.push({ speakerId: speaker, role: ev.role, day, at: ev.at });
        if (ev.role === "mafia") bump(mind.suspicion, speaker, 30);
        else if (ev.role === "jester") bump(mind.suspicion, speaker, 4);
        else if (ev.role === "villager") bump(mind.suspicion, speaker, -2 * g * cred);
        else {
          // Claiming a power role is a big step: believed, by a gullible bot more than a careful one.
          bump(mind.suspicion, speaker, -7 * g * cred);
          bump(mind.trust, speaker, 3 * g * cred);
        }
        break;
      }
      case "result_claim": {
        // A result is also a Detective claim.
        const latest = [...mind.roleClaims].reverse().find((c) => c.speakerId === speaker);
        if (latest?.role !== "detective") mind.roleClaims.push({ speakerId: speaker, role: "detective", day, at: ev.at });
        mind.resultClaims.push({ speakerId: speaker, targetId: ev.targetId, result: ev.result, night: ev.night, day, at: ev.at });
        mind.statements.push({ speakerId: speaker, messageId: ev.messageId, kind: ev.result === "mafia" ? "accuse" : "defend", targetId: ev.targetId, confident: true, day, at: ev.at });
        if (ev.targetId === myId) {
          if (ev.result === "mafia") {
            result.accused = true;
            mind.accusedMe.push({ speakerId: speaker, at: ev.at, messageId: ev.messageId, confident: true });
            if (!innocentMe) bump(mind.threat, speaker, 40);
          } else {
            bump(mind.trust, speaker, 5);
          }
        } else if (team.has(ev.targetId)) {
          if (ev.result === "mafia") bump(mind.threat, speaker, 40);
        } else {
          const raising = ev.result === "mafia";
          bump(mind.suspicion, ev.targetId, (raising ? 26 : -16) * g * cred * resist(mind, ctx, ev.targetId, raising, false));
        }
        result.persuaded = true;
        break;
      }
      case "accuse": {
        mind.statements.push({ speakerId: speaker, messageId: ev.messageId, kind: "accuse", targetId: ev.targetId, confident: ev.confident, day, at: ev.at });
        const verified = ev.evidence === "votes" ? votedForSomeoneInnocent(mind, ev.targetId) : null;
        if (ev.evidence === null) mind.unsupported[speaker] = (mind.unsupported[speaker] ?? 0) + 1;
        const evidence = ev.evidence === "votes" ? (verified ? 2.2 : 0.8) : ev.evidence === "claim" ? 1.3 : 1;
        if (ev.targetId === myId) {
          result.accused = true;
          mind.accusedMe.push({ speakerId: speaker, at: ev.at, messageId: ev.messageId, confident: ev.confident });
          // Accused: defensive, and (knowing it is innocent) more suspicious of the accuser.
          if (innocentMe) bump(mind.suspicion, speaker, (ev.confident ? 9 : 5) * (0.6 + p.aggression));
          else bump(mind.threat, speaker, ev.confident ? 12 : 6);
        } else if (team.has(ev.targetId)) {
          bump(mind.threat, speaker, ev.confident ? 10 : 5);
        } else {
          const base = (ev.confident ? 14 : 5) * claimWeight(mind, speaker);
          const strong = ev.evidence === "votes" && verified === true;
          bump(mind.suspicion, ev.targetId, base * evidence * g * cred * resist(mind, ctx, ev.targetId, true, strong));
        }
        result.persuaded = true;
        break;
      }
      case "defend": {
        mind.statements.push({ speakerId: speaker, messageId: ev.messageId, kind: "defend", targetId: ev.targetId, confident: false, day, at: ev.at });
        if (ev.targetId === speaker) {
          bump(mind.suspicion, speaker, -1.5 * g * cred);
        } else if (ev.targetId === myId) {
          bump(mind.trust, speaker, 5 * (0.5 + g));
        } else {
          link(mind, speaker, ev.targetId);
          if (!team.has(ev.targetId)) bump(mind.suspicion, ev.targetId, -5 * g * cred * resist(mind, ctx, ev.targetId, false, false));
        }
        result.persuaded = true;
        break;
      }
      case "vote_request": {
        mind.statements.push({ speakerId: speaker, messageId: ev.messageId, kind: "vote_request", targetId: ev.targetId, confident: true, day, at: ev.at });
        if (ev.targetId === myId) {
          result.accused = true;
          mind.accusedMe.push({ speakerId: speaker, at: ev.at, messageId: ev.messageId, confident: false });
          if (innocentMe) bump(mind.suspicion, speaker, 5 * (0.6 + p.aggression));
          else bump(mind.threat, speaker, 6);
        } else if (!team.has(ev.targetId)) {
          const asked = (ev.toId === myId ? 12 : 6) * claimWeight(mind, speaker);
          const weight = asked * g * cred * (ev.targetId === SKIP ? 1 : resist(mind, ctx, ev.targetId, true, false));
          mind.voteRequests[ev.targetId] = (mind.voteRequests[ev.targetId] ?? 0) + weight;
        }
        result.persuaded = true;
        break;
      }
      case "question": {
        if (ev.toId === myId) {
          mind.questions.push({ speakerId: speaker, about: ev.about, at: ev.at, messageId: ev.messageId });
          result.questioned = true;
        }
        break;
      }
      case "alliance": {
        link(mind, speaker, ev.withId);
        if (ev.withId === myId) bump(mind.trust, speaker, 10 * (0.4 + g));
        break;
      }
      case "vote_evidence": {
        const fact = votedFor(mind, ev.aboutId, ev.votedForId);
        if (fact === true) {
          // A true fact about the votes: worth more than any amount of shouting.
          const target = view.players.find((x) => x.id === ev.votedForId);
          const weight = target?.role === "mafia" ? -6 : target?.role ? 9 : 5;
          if (ev.aboutId !== myId && !team.has(ev.aboutId)) {
            bump(mind.suspicion, ev.aboutId, weight * (0.5 + 0.5 * g) * resist(mind, ctx, ev.aboutId, weight > 0, true));
          }
          mind.credibility[speaker] = (mind.credibility[speaker] ?? 1) + 0.05;
        } else if (fact === false) {
          // A false one: the speaker is making things up.
          mind.credibility[speaker] = (mind.credibility[speaker] ?? 1) - 0.2;
          bump(mind.suspicion, speaker, 4);
        }
        result.persuaded = true;
        break;
      }
      case "call_out": {
        mind.calledOut.push(contradictionKey(ev.contradiction, ev.targetId, ev.aboutId));
        if (ev.targetId === myId) {
          result.accused = true;
          mind.accusedMe.push({ speakerId: speaker, at: ev.at, messageId: ev.messageId, confident: true });
        } else if (!team.has(ev.targetId)) {
          bump(mind.suspicion, ev.targetId, 10 * g * cred);
        }
        result.persuaded = true;
        break;
      }
    }
  }
  if (mind.heardKeys.length > 800) mind.heardKeys = mind.heardKeys.slice(-600);
  result.noticed = checkContradictions(mind, ctx) > 0;
  return result;
}

/** Someone claiming to be the Detective (and not caught lying) is listened to more. */
function claimWeight(mind: Mind, speaker: string): number {
  return claimers(mind, "detective").includes(speaker) ? 1.8 : 1;
}

/** Did this player vote for someone later shown to be innocent (or for anyone, when nothing is revealed)? */
function votedForSomeoneInnocent(mind: Mind, id: string): boolean | null {
  const rounds = mind.ballots.filter((b) => b.ballots[id] !== undefined);
  if (rounds.length === 0) return null;
  return rounds.some((b) => {
    const target = b.ballots[id];
    if (!target || target === SKIP) return false;
    const role = mind.revealed[target];
    return role !== undefined ? role !== "mafia" : true;
  });
}

// ---------------------------------------------------------------- catching lies

/** How likely this bot is to notice a contradiction, by difficulty. */
function noticeChance(difficulty: BotDifficulty, isPrivate: boolean): number {
  if (difficulty === "hard") return 1;
  if (difficulty === "easy") return isPrivate ? 0.75 : 0.35;
  return isPrivate ? 1 : 0.8;
}

/**
 * Considers a contradiction once (noticed or missed, it is never rolled
 * again). Noticed: a big jump in suspicion, and the liar loses credibility.
 */
function remember(mind: Mind, ctx: MindContext, c: Contradiction, weight: number): boolean {
  const you = ctx.view.you;
  if (!you || mind.checked.includes(c.key)) return false;
  mind.checked.push(c.key);
  if (c.liarId === you.id) return false;
  const team = new Set(you.teammateIds);
  // Decided once, the same way every time (no re-rolling until it is noticed).
  if (hashUnit(`${you.id}:${c.key}`) >= noticeChance(ctx.difficulty, c.private)) return false;
  mind.contradictions.push(c);
  // Caught out: not believed any more, and whatever trust their claim earned is gone.
  mind.credibility[c.liarId] = Math.min(mind.credibility[c.liarId] ?? 1, 0.15);
  delete mind.trust[c.liarId];
  if (!team.has(c.liarId)) bump(mind.suspicion, c.liarId, weight);
  return true;
}

/** Checks the claims ledger against itself, the revealed roles and this bot's own knowledge. */
export function checkContradictions(mind: Mind, ctx: MindContext): number {
  const { view } = ctx;
  const you = view.you;
  if (!you) return 0;
  const myId = you.id;
  const day = mind.day;
  let found = 0;
  const note = (c: Contradiction, weight: number): boolean => {
    const noticed = remember(mind, ctx, c, weight);
    if (noticed) found++;
    return noticed;
  };

  // Each speaker's claims, in order.
  const bySpeaker = new Map<string, Role[]>();
  for (const c of mind.roleClaims) {
    const list = bySpeaker.get(c.speakerId) ?? [];
    if (list.at(-1) !== c.role) list.push(c.role);
    bySpeaker.set(c.speakerId, list);
  }

  // Someone who claimed one role and later another.
  for (const [speaker, roles] of bySpeaker) {
    if (roles.length < 2) continue;
    const before = roles[roles.length - 2];
    const now = roles[roles.length - 1];
    if (!before || !now) continue;
    // "Villager" first, then a power role, is what a hiding Doctor does: suspicious, not proof.
    const weight = before === "villager" ? 10 : 40;
    note({ key: `changed_claim:${speaker}:${roles.join(">")}`, kind: "changed_claim", liarId: speaker, aboutId: null, role: now, private: false, day }, weight);
  }

  // Two living players claiming the same one-of-a-kind role (or this bot holds it).
  const firstClaim = new Map<string, number>();
  for (const c of mind.roleClaims) if (!firstClaim.has(`${c.speakerId}:${c.role}`)) firstClaim.set(`${c.speakerId}:${c.role}`, c.at);
  for (const role of UNIQUE_ROLES) {
    const holders = [...bySpeaker.entries()]
      .filter(([id, roles]) => roles.at(-1) === role && isAlive(view, id) && mind.revealed[id] === undefined)
      .map(([id]) => id)
      .sort((a, b) => (firstClaim.get(`${a}:${role}`) ?? 0) - (firstClaim.get(`${b}:${role}`) ?? 0));
    if (you.role === role) {
      for (const other of holders.filter((id) => id !== myId)) {
        note({ key: `double_claim:${other}:${myId}`, kind: "double_claim", liarId: other, aboutId: myId, role, private: true, day }, 60);
      }
      continue;
    }
    const [first, ...later] = holders.filter((id) => id !== myId);
    for (const other of later) {
      if (!first) break;
      if (note({ key: `double_claim:${other}:${first}`, kind: "double_claim", liarId: other, aboutId: first, role, private: false, day }, 30)) {
        bump(mind.suspicion, first, 10);
      }
    }
  }

  // A claim that a revealed role proves false.
  for (const [revealedId, role] of Object.entries(mind.revealed)) {
    if (UNIQUE_ROLES.includes(role)) {
      for (const [speaker, roles] of bySpeaker) {
        if (speaker === revealedId || !roles.includes(role)) continue;
        note({ key: `revealed_role:${speaker}:${revealedId}`, kind: "revealed_role", liarId: speaker, aboutId: revealedId, role, private: false, day }, 45);
      }
    }
    // A liar revealed: their claims were lies, so whoever they framed is probably innocent.
    const claimed = bySpeaker.get(revealedId)?.at(-1);
    if (claimed && claimed !== role && role === "mafia" && !mind.checked.includes(`exposed:${revealedId}`)) {
      mind.checked.push(`exposed:${revealedId}`);
      for (const r of mind.resultClaims) if (r.speakerId === revealedId && r.result === "mafia") bump(mind.suspicion, r.targetId, -20);
    }
  }

  // A "Detective" result the revealed role (or this bot's own knowledge) proves wrong.
  for (const r of mind.resultClaims) {
    const role = mind.revealed[r.targetId];
    if (role !== undefined && (r.result === "mafia") !== (role === "mafia")) {
      note({ key: `wrong_result:${r.speakerId}:${r.targetId}`, kind: "wrong_result", liarId: r.speakerId, aboutId: r.targetId, role, private: false, day }, 50);
    }
    if (r.targetId === myId && r.result === "mafia" && you.role !== "mafia" && you.role !== null) {
      note({ key: `wrong_result:${r.speakerId}:${myId}`, kind: "wrong_result", liarId: r.speakerId, aboutId: myId, role: null, private: false, day }, 45);
    }
    const mine = you.investigations.find((i) => i.targetId === r.targetId);
    if (mine && mine.isMafia !== (r.result === "mafia")) {
      note({ key: `wrong_result:${r.speakerId}:${r.targetId}:mine`, kind: "wrong_result", liarId: r.speakerId, aboutId: r.targetId, role: null, private: true, day }, 55);
    }
  }
  return found;
}
