/**
 * How a bot votes and what it does at night, from its memory (mind.ts) and
 * the options the server offered its seat. Easy bots mostly pick at random;
 * Normal and Hard bots reason, and Hard ones with less randomness.
 */
import { SKIP, type BotDifficulty, type GameView } from "@mafia/shared";
import { best, claimers, heat, living, score, type Mind, type Random } from "./mind.js";
import type { BotPersonality } from "./personality.js";

function pick<T>(items: readonly T[], random: Random): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const JITTER: Record<BotDifficulty, number> = { easy: 14, normal: 6, hard: 2 };

export interface VoteOptions {
  /** Thinking again after voting: no random picks, so only a real change of mind moves the vote. */
  reconsider?: boolean;
}

/** How much a bot wants to vote for each option (higher = more), from its own point of view. */
export function voteValue(mind: Mind, view: GameView, personality: BotPersonality, id: string): number {
  const tally = view.voting?.live.tally ?? {};
  const crowd = 1.5 + 3 * personality.gullibility;
  return score(mind, view, id) + (mind.voteRequests[id] ?? 0) + (tally[id] ?? 0) * crowd;
}

/** Who to vote for (or SKIP), from the voting options the server offered this seat. */
export function chooseVote(
  mind: Mind,
  view: GameView,
  difficulty: BotDifficulty,
  random: Random,
  personality: BotPersonality,
  options: VoteOptions = {},
): string | null {
  const voting = view.voting;
  const you = view.you;
  if (!voting || !you) return null;
  const offered = voting.validTargetIds;
  if (offered.length === 0) return null;
  const people = offered.filter((o) => o !== SKIP);
  const canSkip = offered.includes(SKIP);
  if (people.length === 0) return canSkip ? SKIP : null;

  if (you.role === "jester" || (difficulty === "easy" && !options.reconsider && random() < 0.6)) {
    if (canSkip && random() < 0.15) return SKIP;
    return pick(people, random) ?? null;
  }

  const team = new Set(you.teammateIds);
  const tally = voting.live.tally;
  const electorate = living(view).filter((p) => p.connected).length;
  const jitter = options.reconsider ? 0 : JITTER[difficulty];

  if (you.role === "mafia") {
    // Join a vote against a teammate only when it's already decided: refusing would look too obvious.
    const doomed = [...team].find((t) => people.includes(t) && (tally[t] ?? 0) * 2 >= electorate);
    if (doomed && random() < (difficulty === "hard" ? 0.8 : 0.6)) return doomed;
    const others = people.filter((p) => !team.has(p));
    if (others.length === 0) return canSkip ? SKIP : (pick(people, random) ?? null);
    // Push the vote onto someone the town already doubts (bandwagon), or onto whoever is onto us.
    return (
      best(others, (id) => voteValue(mind, view, personality, id) + heat(mind, view, id) * 1.5 + (mind.threat[id] ?? 0) * 0.8, random, jitter) ??
      null
    );
  }

  // Town: the most suspicious player, persuaded by what was said and following the crowd a little.
  const top = best(people, (id) => voteValue(mind, view, personality, id), random, jitter);
  if (!top) return canSkip ? SKIP : null;
  const topValue = voteValue(mind, view, personality, top);
  if (canSkip) {
    const skipWanted = mind.voteRequests[SKIP] ?? 0;
    if (skipWanted > topValue) return SKIP;
    if (topValue < 8 && !options.reconsider && random() < (difficulty === "hard" ? 0.3 : 0.5)) return SKIP;
  }
  if (!options.reconsider && difficulty === "normal" && random() < 0.08) return pick(people, random) ?? top;
  return top;
}

/** Whether a vote already cast should change to `next` (only for a clear change of mind). */
export function shouldChangeVote(mind: Mind, view: GameView, personality: BotPersonality, current: string, next: string): boolean {
  if (current === next) return false;
  if (next === SKIP || current === SKIP) return next === SKIP ? false : voteValue(mind, view, personality, next) >= 10;
  const margin = 4 + 6 * personality.stubbornness;
  return voteValue(mind, view, personality, next) - voteValue(mind, view, personality, current) >= margin;
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
  const jitter = JITTER[difficulty] + 4;

  if (action.kind === "link") {
    const [a, b] = shuffle(valid, random);
    if (!a || !b) return null;
    if (difficulty !== "easy" && random() < 0.5 && valid.includes(you.id)) {
      const partner = pick(others, random);
      if (partner) return { targetId: you.id, secondTargetId: partner };
    }
    return { targetId: a, secondTargetId: b };
  }

  if (difficulty === "easy") {
    const choice = pick(action.kind === "protect" ? valid : others.length > 0 ? others : valid, random);
    return choice ? { targetId: choice } : null;
  }

  const detectives = claimers(mind, "detective");
  const doctors = claimers(mind, "doctor");

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
      // Otherwise whoever is onto us, a claimed Detective or Doctor, or someone the town trusts.
      const target = best(
        valid,
        (id) =>
          (mind.threat[id] ?? 0) * 1.5 +
          (detectives.includes(id) ? 50 : 0) +
          (doctors.includes(id) ? 25 : 0) -
          score(mind, view, id) * 0.3,
        random,
        jitter,
      );
      return target ? { targetId: target } : null;
    }
    case "protect": {
      const claimer = detectives.find((id) => valid.includes(id) && id !== you.id);
      if (claimer && random() < 0.6) return { targetId: claimer };
      if (valid.includes(you.id) && random() < 0.25) return { targetId: you.id };
      const trusted = best(others.length > 0 ? others : valid, (id) => -score(mind, view, id) + (mind.trust[id] ?? 0), random, jitter);
      return trusted ? { targetId: trusted } : null;
    }
    case "investigate": {
      const checked = new Set(you.investigations.map((i) => i.targetId));
      const fresh = others.filter((id) => !checked.has(id));
      const pool = fresh.length > 0 ? fresh : others;
      const target = random() < (difficulty === "hard" ? 0.05 : 0.15) ? pick(pool, random) : best(pool, (id) => score(mind, view, id), random, jitter);
      return target ? { targetId: target } : null;
    }
    case "guard": {
      const claimer = detectives.find((id) => others.includes(id));
      if (claimer && random() < 0.6) return { targetId: claimer };
      const trusted = best(others, (id) => -score(mind, view, id) + (mind.trust[id] ?? 0), random, jitter);
      return trusted ? { targetId: trusted } : null;
    }
  }
}

/** Mafia bots: who to suggest in the Mafia chat (the same reasoning as their own pick). */
export function mafiaSuggestion(mind: Mind, view: GameView, random: Random): string | null {
  return chooseNight(mind, view, "normal", random)?.targetId ?? null;
}
