/**
 * End-of-game highlights: who survived longest, the sharpest Town player, and
 * the most suspicious voter. Worked out on the server from the round history,
 * and only sent once the game is over (when every role is public anyway).
 */
import { SKIP, type GameStatsView } from "@mafia/shared";
import type { GameState } from "./types.js";

/** Who's tied for the highest score (none when the best is zero or less). */
function leaders(scores: Map<string, number>): { ids: string[]; best: number } {
  let best = 0;
  for (const score of scores.values()) best = Math.max(best, score);
  if (best <= 0) return { ids: [], best: 0 };
  return { ids: [...scores].filter(([, s]) => s === best).map(([id]) => id), best };
}

export function gameStats(state: GameState): GameStatsView {
  const playing = state.players.filter((p) => p.role !== null && !p.kicked);
  const isMafia = new Map(playing.map((p) => [p.id, p.role === "mafia"]));
  const votesSecret = !state.settings.showVotes;

  // ---------------------------------------------------------------- survived longest
  // Steps: night of round r = 2r - 1, the vote of round r = 2r. Still in at the end beats everything.
  const leftAt = new Map<string, number>();
  for (const log of state.history) {
    for (const d of log.night.deaths) if (!leftAt.has(d.playerId)) leftAt.set(d.playerId, 2 * log.round - 1);
    for (const d of log.vote?.deaths ?? []) if (!leftAt.has(d.playerId)) leftAt.set(d.playerId, 2 * log.round);
  }
  const order = new Map(state.players.map((p, i) => [p.id, i]));
  const inOrder = (ids: string[]) => [...ids].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
  const stillIn = playing.filter((p) => p.alive).map((p) => p.id);
  const survivedLongest: GameStatsView["survivedLongest"] = stillIn.length > 0 ? { playerIds: stillIn } : null;

  let lastToLeave: GameStatsView["lastToLeave"] = null;
  const gone = playing.filter((p) => !p.alive && leftAt.has(p.id));
  if (gone.length > 0) {
    const latest = Math.max(...gone.map((p) => leftAt.get(p.id) ?? 0));
    lastToLeave = {
      playerIds: gone.filter((p) => leftAt.get(p.id) === latest).map((p) => p.id),
      round: Math.ceil(latest / 2),
      part: latest % 2 === 1 ? "night" : "day",
    };
  }

  // ---------------------------------------------------------------- votes, counted per voter
  const ballots = state.history.flatMap((log) => log.vote?.ballots ?? []);
  const mafiaVotes = new Map<string, number>();
  const innocentVotes = new Map<string, number>();
  const totalVotes = new Map<string, number>();
  for (const round of ballots) {
    for (const [voter, target] of Object.entries(round)) {
      if (target === SKIP || !isMafia.has(voter) || !isMafia.has(target)) continue;
      totalVotes.set(voter, (totalVotes.get(voter) ?? 0) + 1);
      const bucket = isMafia.get(target) ? mafiaVotes : innocentVotes;
      bucket.set(voter, (bucket.get(voter) ?? 0) + 1);
    }
  }

  // ---------------------------------------------------------------- best detective (Town only)
  const found = new Map<string, number>();
  const detective = playing.find((p) => p.role === "detective");
  if (detective) found.set(detective.id, state.investigations.filter((i) => i.isMafia).length);
  const detectiveScores = new Map<string, number>();
  for (const p of playing) {
    if (p.role === "mafia" || p.role === "jester") continue;
    const votes = votesSecret ? 0 : (mafiaVotes.get(p.id) ?? 0);
    detectiveScores.set(p.id, votes + (found.get(p.id) ?? 0));
  }
  const bestD = leaders(detectiveScores);
  bestD.ids = inOrder(bestD.ids);
  const bestDetective: GameStatsView["bestDetective"] =
    bestD.ids.length === 0
      ? null
      : {
          playerIds: bestD.ids,
          // Tied players can get there differently (only the Detective investigates), so each has their own counts.
          entries: bestD.ids.map((id) => ({
            playerId: id,
            mafiaVotes: votesSecret ? 0 : (mafiaVotes.get(id) ?? 0),
            mafiaFound: found.get(id) ?? 0,
          })),
        };

  // ---------------------------------------------------------------- most suspicious voter
  let mostSuspiciousVoter: GameStatsView["mostSuspiciousVoter"] = null;
  if (!votesSecret) {
    const sus = leaders(innocentVotes);
    // Ties go to whoever voted against innocents most often for their number of votes.
    const rate = (id: string) => (innocentVotes.get(id) ?? 0) / Math.max(1, totalVotes.get(id) ?? 1);
    const bestRate = Math.max(0, ...sus.ids.map(rate));
    const ids = inOrder(sus.ids.filter((id) => rate(id) === bestRate));
    const top = ids[0];
    if (top !== undefined) {
      mostSuspiciousVoter = { playerIds: ids, innocentVotes: sus.best, totalVotes: totalVotes.get(top) ?? sus.best };
    }
  }

  return { survivedLongest, lastToLeave, bestDetective, mostSuspiciousVoter, votesSecret };
}
