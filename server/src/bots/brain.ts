/**
 * How a bot thinks. Pure functions over what the bot is allowed to know: its
 * own personalised GameView (the same one a human in that seat gets) and the
 * chat messages it could read. Nothing here can see another player's role,
 * the Mafia's target or anything else hidden, because nothing here is given it.
 *
 * Normal bots keep a suspicion score for every other player, built from public
 * information only: votes (when the host shows them), who was eliminated and
 * their role (when revealed), accusations and Detective claims in chat, and
 * voting patterns that look like teams. Easy bots mostly pick at random.
 */
import { SKIP, type BotDifficulty, type ChatMessage, type GameView, type PublicPlayerView, type Role } from "@mafia/shared";
import type { LineKind } from "./lines.js";

export type Random = () => number;

export interface Mind {
  game: number;
  /** How suspicious each player looks to this bot (higher = more likely Mafia). */
  suspicion: Record<string, number>;
  /** A small, fixed personal bias per player, so bots don't all think alike. */
  bias: Record<string, number>;
  /** Mafia bots: how much each player seems to be onto them or their team. */
  threat: Record<string, number>;
  /** Players who claimed in chat to be the Detective. */
  detectiveClaimers: string[];
  /** accuser -> players they accused in chat. */
  accusations: Record<string, string[]>;
  /** Ballots of each finished vote this bot saw (empty when votes are secret). */
  ballots: Record<string, string>[];
  /** What has already been taken into account. */
  seenChat: string[];
  seenVotes: string[];
  seenReveals: string[];
  seenNights: string[];
  /** Mafia bots: the target a teammate suggested in the Mafia chat tonight. */
  teamSuggestion: { round: number; targetId: string; fromHuman: boolean } | null;
  /** Detective bots: investigations already announced in chat. */
  announced: string[];
  /** Someone accused this bot in chat during the current day. */
  accusedOnDay: number | null;
}

export function newMind(game = 0): Mind {
  return {
    game,
    suspicion: {},
    bias: {},
    threat: {},
    detectiveClaimers: [],
    accusations: {},
    ballots: [],
    seenChat: [],
    seenVotes: [],
    seenReveals: [],
    seenNights: [],
    teamSuggestion: null,
    announced: [],
    accusedOnDay: null,
  };
}

const TOWN_ROLES: readonly Role[] = ["doctor", "detective", "villager", "bodyguard", "cupid"];
const clamp = (n: number) => Math.max(-60, Math.min(120, n));

function bump(map: Record<string, number>, id: string, by: number): void {
  map[id] = clamp((map[id] ?? 0) + by);
}

export function me(view: GameView): PublicPlayerView | undefined {
  return view.players.find((p) => p.id === view.you?.id);
}

export function living(view: GameView): PublicPlayerView[] {
  return view.players.filter((p) => p.alive && !p.kicked);
}

function nameOf(view: GameView, id: string): string {
  return view.players.find((p) => p.id === id)?.name ?? "someone";
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

const CLAIM = /\b(checked|investigated|i'?m the detective|i am the detective)\b/i;
const CLEAN = /\b(not|isn'?t|clean|innocent|town|good)\b/i;
const GUILTY = /\b(mafia|gang|sneaky|guilty|bad guy)\b/i;
const ACCUSE = /(don'?t trust|sus\b|suspicious|odd|off\b|lying|liar|guilty|vote|my guess|eyes on|doesn'?t add up|quiet|funny feeling|explain|where were you)/i;
const TRUST = /\b(trust|fine|honest|innocent|clean|alright)\b|leave .+ alone|leave .+ out/i;

/**
 * Takes in everything new in the bot's view and chat. Only public facts and
 * what this seat itself knows ever change the scores.
 */
export function observe(mind: Mind, view: GameView, chat: readonly ChatMessage[], random: Random): Mind {
  const you = view.you;
  if (!you) return mind;
  const m = mind.game === view.gameNumber ? mind : newMind(view.gameNumber);
  const myId = you.id;
  const myRole = you.role;
  const team = new Set(you.teammateIds);
  const innocentMe = myRole !== null && myRole !== "mafia";

  for (const p of view.players) {
    if (p.id === myId) continue;
    if (m.bias[p.id] === undefined) m.bias[p.id] = (random() - 0.5) * 8;
    if (m.suspicion[p.id] === undefined) m.suspicion[p.id] = 0;
  }

  // Votes, once each round, when the host shows who voted for whom.
  const report = view.voteReport;
  const voteKey = report ? `${view.round}:${report.round}` : null;
  if (report && voteKey && !m.seenVotes.includes(voteKey)) {
    m.seenVotes.push(voteKey);
    const ballots = report.ballots;
    if (Object.keys(ballots).length > 0) m.ballots.push({ ...ballots });
    for (const [voter, target] of Object.entries(ballots)) {
      if (voter === myId || target === SKIP) continue;
      if (target === myId && innocentMe) bump(m.suspicion, voter, 10);
      if (team.has(target) || target === myId) bump(m.threat, voter, 10);
      const role = view.players.find((p) => p.id === target)?.role;
      if (role === "mafia") bump(m.suspicion, voter, -12);
      else if (role && TOWN_ROLES.includes(role)) bump(m.suspicion, voter, 8);
    }
  }

  // Roles revealed when players leave (if the host shows them): judge past votes by them.
  for (const p of view.players) {
    if (p.alive || !p.role || m.seenReveals.includes(p.id)) continue;
    m.seenReveals.push(p.id);
    for (const round of m.ballots) {
      const theirPick = round[p.id];
      for (const [voter, target] of Object.entries(round)) {
        if (voter === myId || voter === p.id) continue;
        if (p.role === "mafia") {
          if (target === p.id) bump(m.suspicion, voter, -6);
          // Voted exactly like a Mafia member: maybe their teammate.
          else if (theirPick && theirPick !== SKIP && target === theirPick) bump(m.suspicion, voter, 8);
        } else if (target === p.id) {
          bump(m.suspicion, voter, 5);
        }
      }
    }
  }

  // Taken in the night: they were innocent, so whoever they accused looks worse.
  const night = view.nightReport;
  const nightKey = night ? `${night.round}` : null;
  if (night && nightKey && !m.seenNights.includes(nightKey)) {
    m.seenNights.push(nightKey);
    for (const death of night.deaths) {
      if (death.cause !== "mafia") continue;
      for (const accused of m.accusations[death.playerId] ?? []) if (accused !== myId) bump(m.suspicion, accused, 6);
    }
  }

  // Chat: accusations, Detective claims and, for the Mafia, a teammate's suggestion.
  for (const message of chat) {
    if (m.seenChat.includes(message.id)) continue;
    m.seenChat.push(message.id);
    if (message.senderId === myId || message.reaction) continue;
    const sender = message.senderId;
    const targets = mentioned(view, message.text, sender);
    if (message.channel === "mafia") {
      const target = targets.find((t) => !team.has(t) && t !== myId);
      if (target) {
        const fromHuman = !view.players.find((p) => p.id === sender)?.isBot;
        m.teamSuggestion = { round: view.round, targetId: target, fromHuman };
      }
      continue;
    }
    if (message.channel !== "public" || targets.length === 0) continue;
    const text = message.text;
    if (CLAIM.test(text)) {
      if (!m.detectiveClaimers.includes(sender)) m.detectiveClaimers.push(sender);
      for (const t of targets) {
        if (CLEAN.test(text) && !GUILTY.test(text)) {
          bump(m.suspicion, t, -12);
        } else if (GUILTY.test(text)) {
          if (t === myId && innocentMe) bump(m.suspicion, sender, 45); // a lie about me: they're likely Mafia
          else if (team.has(t) || t === myId) bump(m.threat, sender, 40); // the real Detective, probably
          else bump(m.suspicion, t, 35); // follow a strong accusation
        }
      }
      continue;
    }
    if (ACCUSE.test(text)) {
      for (const t of targets) {
        (m.accusations[sender] ??= []).push(t);
        if (t === myId) {
          m.accusedOnDay = view.round;
          if (innocentMe) bump(m.suspicion, sender, 6);
          else bump(m.threat, sender, 8);
        } else if (team.has(t)) {
          bump(m.threat, sender, 6);
        } else {
          bump(m.suspicion, t, 5);
        }
      }
    } else if (TRUST.test(text)) {
      for (const t of targets) if (t !== myId) bump(m.suspicion, t, -4);
    }
  }
  if (m.seenChat.length > 400) m.seenChat = m.seenChat.slice(-300);
  return m;
}

/** How suspicious a player looks right now to this bot, including what its own role learned. */
export function score(mind: Mind, view: GameView, id: string): number {
  const you = view.you;
  let s = (mind.suspicion[id] ?? 0) + (mind.bias[id] ?? 0);
  const found = you?.investigations.filter((i) => i.targetId === id) ?? [];
  if (found.some((i) => i.isMafia)) s += 200;
  else if (found.length > 0) s -= 80;
  if (you?.loverIds?.includes(id) && you.loverIds.includes(you.id)) s -= 100;
  if (mind.detectiveClaimers.includes(id)) s -= 6;
  return s;
}

function pick<T>(items: readonly T[], random: Random): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function best(ids: readonly string[], value: (id: string) => number, random: Random, jitter = 6): string | undefined {
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

// ------------------------------------------------------------------ voting

/** Who to vote for (or SKIP), from the voting options the server offered this seat. */
export function chooseVote(mind: Mind, view: GameView, difficulty: BotDifficulty, random: Random): string | null {
  const voting = view.voting;
  const you = view.you;
  if (!voting || !you) return null;
  const options = voting.validTargetIds;
  if (options.length === 0) return null;
  const people = options.filter((o) => o !== SKIP);
  const canSkip = options.includes(SKIP);
  if (people.length === 0) return canSkip ? SKIP : null;

  if (difficulty === "easy" || you.role === "jester") {
    if (canSkip && random() < 0.15) return SKIP;
    return pick(people, random) ?? null;
  }

  const team = new Set(you.teammateIds);
  const tally = voting.live.tally;
  const electorate = living(view).filter((p) => p.connected).length;

  if (you.role === "mafia") {
    // Join a vote against a teammate only when it's already decided: refusing would look too obvious.
    const doomed = [...team].find((t) => people.includes(t) && (tally[t] ?? 0) * 2 >= electorate);
    if (doomed && random() < 0.6) return doomed;
    const others = people.filter((p) => !team.has(p));
    if (others.length === 0) return canSkip ? SKIP : (pick(people, random) ?? null);
    // Push the vote onto someone the town already doubts, or onto whoever is onto us.
    return best(others, (id) => score(mind, view, id) + (mind.threat[id] ?? 0) * 0.8 + (tally[id] ?? 0) * 3, random, 8) ?? null;
  }

  // Town (and the Detective): the most suspicious player, following the crowd a little.
  const top = best(people, (id) => score(mind, view, id) + (tally[id] ?? 0) * 3, random, 8);
  if (!top) return canSkip ? SKIP : null;
  const topScore = score(mind, view, top) + (tally[top] ?? 0) * 3;
  if (canSkip && topScore < 8 && random() < 0.5) return SKIP;
  if (random() < 0.1) return pick(people, random) ?? top;
  return top;
}

// ------------------------------------------------------------------ night

export interface NightChoice {
  targetId: string;
  secondTargetId?: string;
}

/** What to do tonight, from the night action the server offered this seat (null: nothing to do). */
export function chooseNight(mind: Mind, view: GameView, difficulty: BotDifficulty, random: Random): NightChoice | null {
  const you = view.you;
  const action = you?.nightAction;
  if (!you || !action) return null;
  const valid = action.validTargetIds;
  if (valid.length === 0) return null;
  const others = valid.filter((id) => id !== you.id);

  if (action.kind === "link") {
    const [a, b] = shuffle(valid, random);
    if (!a || !b) return null;
    if (difficulty === "normal" && random() < 0.5 && valid.includes(you.id)) {
      const partner = pick(others, random);
      if (partner) return { targetId: you.id, secondTargetId: partner };
    }
    return { targetId: a, secondTargetId: b };
  }

  if (difficulty === "easy") {
    const choice = pick(action.kind === "protect" ? valid : others.length > 0 ? others : valid, random);
    return choice ? { targetId: choice } : null;
  }

  switch (action.kind) {
    case "kill": {
      const team = new Set(you.teammateIds);
      const humanTeammates = new Set(view.players.filter((p) => team.has(p.id) && !p.isBot).map((p) => p.id));
      const picks = Object.entries(action.teammateVotes ?? {}).filter(([voter, t]) => voter !== you.id && valid.includes(t));
      // Go with the team: a human teammate's pick first, then a suggestion in the Mafia chat, then a bot teammate's.
      const humanPick = picks.find(([voter]) => humanTeammates.has(voter))?.[1];
      if (humanPick && random() < 0.9) return { targetId: humanPick };
      const suggestion = mind.teamSuggestion;
      if (suggestion && suggestion.round === view.round && valid.includes(suggestion.targetId) && random() < (suggestion.fromHuman ? 0.85 : 0.6)) {
        return { targetId: suggestion.targetId };
      }
      const botPick = picks[0]?.[1];
      if (botPick && random() < 0.7) return { targetId: botPick };
      // Otherwise whoever is onto us, a claimed Detective, or someone the town trusts.
      const target = best(
        valid,
        (id) => (mind.threat[id] ?? 0) * 1.5 + (mind.detectiveClaimers.includes(id) ? 50 : 0) - score(mind, view, id) * 0.3,
        random,
        10,
      );
      return target ? { targetId: target } : null;
    }
    case "protect": {
      const claimer = mind.detectiveClaimers.find((id) => valid.includes(id) && id !== you.id);
      if (claimer && random() < 0.6) return { targetId: claimer };
      if (valid.includes(you.id) && random() < 0.25) return { targetId: you.id };
      const trusted = best(others.length > 0 ? others : valid, (id) => -score(mind, view, id), random, 10);
      return trusted ? { targetId: trusted } : null;
    }
    case "investigate": {
      const checked = new Set(you.investigations.map((i) => i.targetId));
      const fresh = others.filter((id) => !checked.has(id));
      const pool = fresh.length > 0 ? fresh : others;
      const target = random() < 0.15 ? pick(pool, random) : best(pool, (id) => score(mind, view, id), random, 10);
      return target ? { targetId: target } : null;
    }
    case "guard": {
      const claimer = mind.detectiveClaimers.find((id) => others.includes(id));
      if (claimer && random() < 0.6) return { targetId: claimer };
      const trusted = best(others, (id) => -score(mind, view, id), random, 10);
      return trusted ? { targetId: trusted } : null;
    }
  }
}

/** Mafia bots: who to suggest in the Mafia chat (the same reasoning as their own pick). */
export function mafiaSuggestion(mind: Mind, view: GameView, random: Random): string | null {
  return chooseNight(mind, view, "normal", random)?.targetId ?? null;
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// ------------------------------------------------------------------ talking

export interface Remark {
  kind: LineKind;
  /** The player the line is about, if any. */
  about?: string;
}

/**
 * What this bot will say during one day discussion (at most a couple of lines).
 * A Detective who found a Mafia member may say so; the Mafia deflect; the
 * Jester tries to look guilty; everyone accuses whoever looks worst to them.
 */
export function dayRemarks(mind: Mind, view: GameView, difficulty: BotDifficulty, random: Random): Remark[] {
  const you = view.you;
  if (!you || !you.role) return [];
  const others = living(view).filter((p) => p.id !== you.id).map((p) => p.id);
  if (others.length === 0) return [];
  const remarks: Remark[] = [];
  const max = difficulty === "easy" ? (random() < 0.5 ? 1 : 0) : 1 + (random() < 0.5 ? 1 : 0);

  if (you.role === "detective") {
    const found = you.investigations.find((i) => i.isMafia && others.includes(i.targetId) && !mind.announced.includes(i.targetId));
    if (found && random() < (difficulty === "easy" ? 0.3 : 0.6)) {
      mind.announced.push(found.targetId);
      remarks.push({ kind: "claim", about: found.targetId });
    }
  }
  if (mind.accusedOnDay === view.round && you.role !== "jester" && random() < 0.6) remarks.push({ kind: "defend" });
  if (you.role === "jester" && random() < 0.5) remarks.push({ kind: "jester" });

  while (remarks.length < max) {
    const pool = you.role === "mafia" ? others.filter((id) => !you.teammateIds.includes(id)) : others;
    const suspect = difficulty === "easy" ? pick(pool, random) : best(pool, (id) => score(mind, view, id), random, 8);
    const roll = random();
    if (!suspect || roll < 0.2) remarks.push({ kind: "chatter" });
    else if (difficulty === "normal" && score(mind, view, suspect) < 3 && roll < 0.45) remarks.push({ kind: "trust", about: pick(pool, random) ?? suspect });
    else remarks.push({ kind: roll < 0.75 ? "accuse" : "question", about: suspect });
  }
  return remarks.slice(0, Math.max(max, remarks.length > 0 ? 1 : 0) + 1);
}

export function playerName(view: GameView, id: string | undefined): string | undefined {
  return id === undefined ? undefined : nameOf(view, id);
}
