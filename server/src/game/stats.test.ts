import { describe, expect, it } from "vitest";
import { getGameView } from "./view.js";
import { R8, gameWithRoles, runNight, runVote } from "./testing/harness.js";

/**
 * 8 players: p1, p2 Mafia; p3 Doctor; p4 Detective; p5–p8 villagers.
 * Night 1 the Mafia take p5 and the Detective finds p1. Day 1 the town votes p1 out (p8 votes the Doctor, the
 * Mafia vote p8). Night 2 the Mafia take p7 and the Detective finds p2. Day 2 the town votes p2 out: the Town wins.
 */
function scriptedGame(settings: Record<string, unknown> = {}) {
  const g = gameWithRoles(R8, { settings });
  runNight(g, [["p1", "p5"], ["p2", "p5"], ["p3", "p6"], ["p4", "p1"]]);
  g.advanceTo("VOTING");
  runVote(g, { p4: "p1", p6: "p1", p7: "p1", p3: "p1", p8: "p3", p1: "p8", p2: "p8" });
  g.advanceTo("NIGHT");
  runNight(g, [["p2", "p7"], ["p3", "p8"], ["p4", "p2"]]);
  g.advanceTo("VOTING");
  runVote(g, { p4: "p2", p6: "p2", p3: "p2", p8: "p3", p2: "p8" });
  g.advanceTo("GAME_OVER");
  return g;
}

describe("end-of-game stats", () => {
  it("are only sent once the game is over", () => {
    const g = gameWithRoles(R8);
    expect(getGameView(g.state, "p1").stats).toBeNull();
    expect(getGameView(g.state, "p5").stats).toBeNull();
  });

  it("name everyone still in at the end as having survived longest", () => {
    const g = scriptedGame();
    expect(g.state.winner).toBe("town");
    const stats = getGameView(g.state, "p5").stats;
    expect(stats?.survivedLongest).toEqual({ playerIds: ["p3", "p4", "p6", "p8"] });
    // p5 left on night 1, p1 on day 1, p7 on night 2, p2 on day 2: p2 held on longest
    expect(stats?.lastToLeave).toEqual({ playerIds: ["p2"], round: 2, part: "day" });
  });

  it("make the Detective the best detective: two Mafia votes and two Mafia found", () => {
    const stats = getGameView(scriptedGame().state, "p1").stats;
    expect(stats?.bestDetective).toEqual({ playerIds: ["p4"], entries: [{ playerId: "p4", mafiaVotes: 2, mafiaFound: 2 }] });
  });

  it("find the most suspicious voters: both voted against innocent players every time", () => {
    const stats = getGameView(scriptedGame().state, "p1").stats;
    expect(stats?.mostSuspiciousVoter).toEqual({ playerIds: ["p2", "p8"], innocentVotes: 2, totalVotes: 2 });
    expect(stats?.votesSecret).toBe(false);
  });

  it("are the same for every player and spectator (all public by then)", () => {
    const g = scriptedGame();
    const views = ["p1", "p4", "p8"].map((id) => JSON.stringify(getGameView(g.state, id).stats));
    expect(new Set(views).size).toBe(1);
  });

  it("don't reveal who voted for whom when the host kept votes secret", () => {
    const stats = getGameView(scriptedGame({ showVotes: false }).state, "p1").stats;
    expect(stats?.votesSecret).toBe(true);
    expect(stats?.mostSuspiciousVoter).toBeNull();
    // only the Detective's own investigations count
    expect(stats?.bestDetective).toEqual({ playerIds: ["p4"], entries: [{ playerId: "p4", mafiaVotes: 0, mafiaFound: 2 }] });
  });

  it("never put the ballots into the timeline", () => {
    const g = scriptedGame();
    expect(g.state.history[0]?.vote?.ballots?.[0]).toMatchObject({ p4: "p1", p8: "p3" });
    const view = getGameView(g.state, "p1");
    expect(JSON.stringify(view.timeline)).not.toContain("ballots");
  });

  it("give tied best detectives their own counts (only the Detective investigates)", () => {
    // p3 (Doctor) votes for the Mafia twice; p4 (Detective) votes once and finds one Mafia: a tie on 2.
    const g = gameWithRoles(R8);
    runNight(g, [["p1", "p5"], ["p2", "p5"], ["p3", "p6"], ["p4", "p1"]]);
    g.advanceTo("VOTING");
    runVote(g, { p3: "p1", p4: "p1", p6: "p1", p7: "p1", p8: "p1", p1: "p8", p2: "p8" });
    g.advanceTo("NIGHT");
    runNight(g, [["p2", "p7"], ["p3", "p8"], ["p4", "p6"]]);
    g.advanceTo("VOTING");
    runVote(g, { p3: "p2", p4: "p6", p6: "p2", p8: "p2", p2: "p8" });
    g.advanceTo("GAME_OVER");
    const stats = getGameView(g.state, "p1").stats;
    expect(stats?.bestDetective?.entries).toEqual([
      { playerId: "p3", mafiaVotes: 2, mafiaFound: 0 },
      { playerId: "p4", mafiaVotes: 1, mafiaFound: 1 },
      { playerId: "p6", mafiaVotes: 2, mafiaFound: 0 },
      { playerId: "p8", mafiaVotes: 2, mafiaFound: 0 },
    ]);
  });

  it("count both rounds of a revote", () => {
    const g = gameWithRoles(R8, { settings: { tieRule: "revote" } });
    runNight(g, [["p1", "p5"], ["p2", "p5"], ["p3", "p6"], ["p4", "p6"]]);
    g.advanceTo("VOTING");
    // a three-way tie (everyone votes; a missing vote would count as Skip)
    for (const [v, t] of Object.entries({ p3: "p1", p4: "p1", p6: "p2", p7: "p2", p1: "p8", p2: "p8", p8: "skip" })) g.vote(v, t);
    if (g.phase === "VOTING" && g.state.voting?.round === 1) g.endPhase();
    expect(g.state.voting?.round).toBe(2);
    for (const [v, t] of Object.entries({ p3: "p1", p4: "p1", p6: "p1", p7: "p1", p1: "p8", p2: "p8", p8: "p2" })) g.vote(v, t);
    if (g.phase === "VOTING") g.endPhase();
    expect(g.state.history[0]?.vote?.ballots).toHaveLength(2);
    expect(g.state.history[0]?.vote?.outcome).toBe("eliminated");
  });
});
