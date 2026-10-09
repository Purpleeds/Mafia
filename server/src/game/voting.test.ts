import { SKIP } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { getGameView } from "./view.js";
import { R7, gameWithRoles, runVote, type Game } from "./testing/harness.js";
import type { SettingsPatch } from "@mafia/shared";

function toVoting(settings?: SettingsPatch): Game {
  const g = gameWithRoles(R7, { settings });
  g.advanceTo("VOTING");
  return g;
}

const report = (g: Game) => g.state.voteReport;

describe("day vote", () => {
  it("eliminates the player with the most votes", () => {
    const g = toVoting();
    runVote(g, { p1: "p4", p2: "p4", p3: "p4", p5: "p4", p6: "p5", p4: SKIP });
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(report(g)?.outcome).toBe("eliminated");
    expect(report(g)?.deaths).toEqual([{ playerId: "p4", cause: "vote" }]);
    expect(report(g)?.tally).toEqual({ p4: 4, p5: 1, skip: 2 });
    expect(g.player("p4").alive).toBe(false);
  });

  it("removes no one if skip wins", () => {
    const g = toVoting();
    runVote(g, { p1: SKIP, p2: SKIP, p3: SKIP, p4: SKIP, p5: "p1", p6: "p1", p7: SKIP });
    expect(report(g)?.outcome).toBe("skipped");
    expect(g.state.players.every((p) => p.alive)).toBe(true);
  });

  it("counts players who don't vote as skip, so one vote can't remove anyone", () => {
    const g = toVoting();
    runVote(g, { p1: "p4" }); // six abstain
    expect(report(g)?.outcome).toBe("skipped");
    expect(report(g)?.tally).toEqual({ p4: 1, skip: 6 });
    expect(g.player("p4").alive).toBe(true);
  });

  it("doesn't let anyone vote for themself, a dead player or a stranger", () => {
    const g = toVoting();
    expect(g.fail({ type: "CAST_VOTE", playerId: "p1", targetId: "p1" })).toBe("INVALID_TARGET");
    expect(g.fail({ type: "CAST_VOTE", playerId: "p1", targetId: "ghost" })).toBe("INVALID_TARGET");
    expect(g.fail({ type: "CAST_VOTE", playerId: "ghost", targetId: "p1" })).toBe("NOT_IN_GAME");
  });

  it("keeps ballots secret when the host hides who voted for whom", () => {
    const g = toVoting({ showVotes: false });
    g.vote("p1", "p4");
    const view = getGameView(g.state, "p2");
    expect(view.voting?.myBallot).toBeNull();
    expect(getGameView(g.state, "p1").voting?.myBallot).toBe("p4");
    expect(view.players.find((p) => p.id === "p1")?.done).toBe(true);
    expect(view.voting?.live.ballots).toBeNull();
    expect(JSON.stringify(view)).not.toContain('"ballots":{');
  });

  it("publishes who voted for whom once it closes", () => {
    const g = toVoting();
    runVote(g, { p1: "p4", p2: "p4", p3: "p4", p5: "p4" });
    expect(getGameView(g.state, "p6").voteReport?.ballots).toEqual({ p1: "p4", p2: "p4", p3: "p4", p5: "p4" });
  });

  it("takes the partner of an eliminated player with them", () => {
    const g = gameWithRoles(["mafia", "doctor", "detective", "cupid", "villager", "villager", "villager"]);
    g.nightAct("p4", "p5", "p6");
    g.endPhase();
    g.advanceTo("VOTING");
    runVote(g, { p1: "p5", p2: "p5", p3: "p5", p4: "p5", p7: "p5" });
    expect(report(g)?.deaths).toEqual([
      { playerId: "p5", cause: "vote" },
      { playerId: "p6", cause: "heartbreak" },
    ]);
  });
});

describe("ties", () => {
  // 3 votes for p4, 3 for p5, one skip
  const tie = { p1: "p4", p2: "p4", p3: "p4", p4: "p5", p6: "p5", p7: "p5", p5: SKIP };

  it("removes no one by default", () => {
    const g = toVoting();
    runVote(g, tie);
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(report(g)?.outcome).toBe("tie");
    expect(report(g)?.deaths).toEqual([]);
    expect(g.state.players.every((p) => p.alive)).toBe(true);
  });

  it("starts a revote between the tied players when the host chose that", () => {
    const g = toVoting({ tieRule: "revote" });
    for (const [voter, target] of Object.entries(tie)) g.vote(voter, target);
    // Everyone has voted: last call, then the timer closes the round.
    expect(g.state.voting?.round).toBe(1);
    g.endPhase();
    expect(g.phase).toBe("VOTING");
    expect(g.state.voting).toMatchObject({ round: 2, candidates: ["p4", "p5"], ballots: {} });
    expect(g.state.phaseEndsAt).toBe(g.now + 45_000);
    expect(g.state.voteReport).toBeNull();

    const view = getGameView(g.state, "p4").voting;
    expect(view?.previous?.tiedOptions).toEqual(["p4", "p5"]);
    expect(view?.previous?.tally).toEqual({ p4: 3, p5: 3, skip: 1 });
    // a tied player can't vote for themself; nobody can pick a non-candidate
    expect(view?.validTargetIds).toEqual(["p5", SKIP]);
    expect(getGameView(g.state, "p1").voting?.validTargetIds).toEqual(["p4", "p5", SKIP]);
    expect(g.fail({ type: "CAST_VOTE", playerId: "p1", targetId: "p6" })).toBe("INVALID_TARGET");
  });

  it("eliminates the revote winner", () => {
    const g = toVoting({ tieRule: "revote" });
    for (const [voter, target] of Object.entries(tie)) g.vote(voter, target);
    g.endPhase();
    for (const voter of ["p1", "p2", "p3", "p5"]) g.vote(voter, "p4");
    for (const voter of ["p4", "p6", "p7"]) g.vote(voter, "p5");
    g.endPhase();
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(report(g)).toMatchObject({ round: 2, outcome: "eliminated", deaths: [{ playerId: "p4" }] });
  });

  it("removes no one if the revote ties again", () => {
    const g = toVoting({ tieRule: "revote" });
    for (const [voter, target] of Object.entries(tie)) g.vote(voter, target);
    runVote(g, {});
    for (const [voter, target] of Object.entries({ p1: "p4", p2: "p4", p3: "p4", p4: "p5", p6: "p5", p7: "p5", p5: SKIP })) {
      g.vote(voter, target);
    }
    g.endPhase();
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(report(g)).toMatchObject({ round: 2, outcome: "tie", deaths: [] });
  });

  it("treats a silent revote as skip", () => {
    const g = toVoting({ tieRule: "revote" });
    for (const [voter, target] of Object.entries(tie)) g.vote(voter, target);
    g.endPhase(); // round 1 closes: revote
    g.endPhase(); // nobody votes again
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(report(g)?.outcome).toBe("skipped");
  });

  it("revotes between skip and a player when they tie for first", () => {
    const g = toVoting({ tieRule: "revote" });
    // p4 gets 3, skip gets 3 (p5 and p6 and p7 ...), others split
    runVote(g, { p1: "p4", p2: "p4", p3: "p4", p4: SKIP, p5: SKIP, p6: SKIP, p7: "p6" });
    expect(g.state.voting).toMatchObject({ round: 2, candidates: ["p4"] });
    expect(g.state.voting?.previous?.tiedOptions).toEqual(["p4", SKIP]);
  });
});
