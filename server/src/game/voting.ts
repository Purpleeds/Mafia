import { SKIP, type GameError, type VoteOutcome } from "@mafia/shared";
import { killPlayers } from "./deaths.js";
import { findPlayer, has, livingPlayers } from "./state.js";
import type { GameEnv, GameState, PlayerState } from "./types.js";
import { evaluateWinner } from "./win.js";

export function newVoting(): NonNullable<GameState["voting"]> {
  return { round: 1, candidates: null, ballots: {}, previous: null };
}

/** Everything this voter may put on their ballot (players other than themself, plus SKIP). */
export function validVoteTargets(state: GameState, voter: PlayerState): string[] {
  if (!state.voting || !voter.alive) return [];
  const pool = state.voting.candidates ?? livingPlayers(state).map((p) => p.id);
  return [...pool.filter((id) => id !== voter.id), SKIP];
}

export function castVote(state: GameState, voter: PlayerState, targetId: string): GameError | null {
  if (!state.voting) return { code: "WRONG_PHASE", message: "Voting is not open." };
  if (!voter.alive) return { code: "DEAD_PLAYER", message: "You're out of this game, so you can't vote." };
  if (!validVoteTargets(state, voter).includes(targetId)) {
    return { code: "INVALID_TARGET", message: "You can't vote for that." };
  }
  state.voting.ballots[voter.id] = targetId;
  return null;
}

/** True once every living, connected player has a ballot. */
export function isVotingComplete(state: GameState): boolean {
  const voting = state.voting;
  if (!voting) return false;
  const required = state.players.filter((p) => p.alive && p.connected);
  return required.length > 0 && required.every((p) => has(voting.ballots, p.id));
}

/**
 * Closes the current ballot. The most-voted option wins; players who didn't
 * vote count as SKIP, but disconnected players who didn't vote aren't counted.
 *
 * Returns true if the vote is over (result recorded, ready for VOTE_RESULTS)
 * or false if a tie started a revote (state.voting reset for round 2).
 */
export function resolveVoting(state: GameState, env: GameEnv): boolean {
  const voting = state.voting;
  if (!voting) return true;

  const living = livingPlayers(state);
  const electorate = living.filter((p) => p.connected || has(voting.ballots, p.id));
  const options = [...(voting.candidates ?? living.map((p) => p.id)), SKIP];

  const counts = new Map<string, number>(options.map((o) => [o, 0]));
  for (const voter of electorate) {
    const choice = voting.ballots[voter.id] ?? SKIP;
    counts.set(choice, (counts.get(choice) ?? 0) + 1);
  }

  const tally: Record<string, number> = {};
  for (const [option, n] of counts) if (n > 0) tally[option] = n;
  const summary = { round: voting.round, ballots: { ...voting.ballots }, tally };

  let outcome: VoteOutcome;
  let eliminated: string | null = null;

  if (electorate.length === 0) {
    outcome = "nobody";
  } else {
    const top = Math.max(...counts.values());
    const leaders = options.filter((o) => counts.get(o) === top);
    if (leaders.length === 1) {
      const winner = leaders[0] as string;
      if (winner === SKIP) {
        outcome = "skipped";
      } else {
        outcome = "eliminated";
        eliminated = winner;
      }
    } else if (state.settings.tieRule === "revote" && voting.round === 1) {
      // Second (and last) round, between the tied players only. SKIP stays available.
      state.voting = {
        round: 2,
        candidates: leaders.filter((o) => o !== SKIP),
        ballots: {},
        previous: { ...summary, tiedOptions: leaders },
      };
      state.phaseEndsAt = env.now + state.settings.timers.votingSeconds * 1000;
      return false;
    } else {
      outcome = "tie";
    }
  }

  const deaths = eliminated ? killPlayers(state, [{ playerId: eliminated, cause: "vote" }]) : [];
  state.voteReport = { ...summary, outcome, deaths };
  const entry = state.history.find((h) => h.round === state.round);
  if (entry) entry.vote = { outcome, tally, deaths };

  const jesterOut = eliminated !== null && findPlayer(state, eliminated)?.role === "jester";
  state.pendingWinner = jesterOut ? "jester" : evaluateWinner(state);
  return true;
}
