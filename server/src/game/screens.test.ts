import { SKIP, type Role } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { getGameView } from "./view.js";
import { R7, R8, gameWithRoles, runNight, runVote } from "./testing/harness.js";

describe("live vote counts", () => {
  it("are always shown, with who voted for whom when the host allows it", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    g.vote("p1", "p4");
    g.vote("p2", "p4");
    g.vote("p3", SKIP);
    const view = getGameView(g.state, "p5").voting;
    expect(view?.live.tally).toEqual({ p4: 2, skip: 1 });
    expect(view?.live.ballots).toEqual({ p1: "p4", p2: "p4", p3: "skip" });
  });

  it("hide who voted for whom when the host chose that, but still count", () => {
    const g = gameWithRoles(R7, { settings: { showVotes: false } });
    g.advanceTo("VOTING");
    g.vote("p1", "p4");
    g.vote("p2", "p4");
    const view = getGameView(g.state, "p5");
    expect(view.voting?.live.tally).toEqual({ p4: 2 });
    expect(view.voting?.live.ballots).toBeNull();
    expect(JSON.stringify(view)).not.toContain('"p1":"p4"');
    // you still see your own ballot
    expect(getGameView(g.state, "p1").voting?.myBallot).toBe("p4");
  });

  it("show the voters in the results only if allowed", () => {
    for (const showVotes of [true, false]) {
      const g = gameWithRoles(R7, { settings: { showVotes } });
      g.advanceTo("VOTING");
      runVote(g, { p1: "p4", p2: "p4", p3: "p4", p5: "p4" });
      const report = getGameView(g.state, "p6").voteReport;
      expect(report?.tally.p4).toBe(4);
      expect(report?.ballots).toEqual(showVotes ? { p1: "p4", p2: "p4", p3: "p4", p5: "p4" } : {});
    }
  });

  it("hide the first round's voters in a revote too", () => {
    const g = gameWithRoles(R7, { settings: { showVotes: false, tieRule: "revote" } });
    g.advanceTo("VOTING");
    for (const [v, t] of Object.entries({ p1: "p4", p2: "p4", p3: "p4", p4: "p5", p6: "p5", p7: "p5", p5: SKIP })) g.vote(v, t);
    const previous = getGameView(g.state, "p1").voting?.previous;
    expect(previous?.tally).toEqual({ p4: 3, p5: 3, skip: 1 });
    expect(previous?.ballots).toEqual({});
  });

  it("is a host setting that must be a boolean", () => {
    const g = gameWithRoles(R7);
    expect(g.state.settings.showVotes).toBe(true);
  });
});

describe("chat access in the view", () => {
  it("tells each person which channels they can use right now", () => {
    const g = gameWithRoles(R7);
    // role reveal is over; night
    expect(getGameView(g.state, "p1").you?.chat).toEqual({ write: ["mafia"], read: ["public", "mafia"] });
    expect(getGameView(g.state, "p4").you?.chat).toEqual({ write: [], read: ["public"] });
    runNight(g, [["p1", "p4"]]);
    g.advanceTo("DAY_DISCUSSION");
    expect(getGameView(g.state, "p2").you?.chat.write).toEqual(["public"]);
    expect(getGameView(g.state, "p4").you?.chat).toEqual({ write: ["graveyard"], read: ["public", "graveyard"] });
  });

  it("gives spectators the graveyard", () => {
    const g = gameWithRoles(R7);
    g.ok({ type: "JOIN", playerId: "late", name: "Late", avatar: { color: "red", seed: "fox" } });
    expect(getGameView(g.state, "late").you?.chat).toEqual({ write: ["graveyard"], read: ["public", "graveyard"] });
  });
});

describe("game-over timeline", () => {
  const roles: Role[] = ["mafia", "doctor", "detective", "bodyguard", "villager", "villager", "villager"];

  it("is empty until the game ends, so nothing secret leaks earlier", () => {
    const g = gameWithRoles(roles);
    g.nightAct("p1", "p5");
    g.nightAct("p2", "p5");
    g.nightAct("p3", "p1");
    expect(getGameView(g.state, "p6").timeline).toEqual([]);
    expect(JSON.stringify(getGameView(g.state, "p6"))).not.toMatch(/"protectedId":"/);
  });

  it("records each night's secrets and each vote, and shows them at game over", () => {
    const g = gameWithRoles(roles);
    // night 1: the Doctor saves the Mafia's target; the Detective checks the Mafia
    g.nightAct("p1", "p5");
    g.nightAct("p2", "p5");
    g.nightAct("p3", "p1");
    g.advanceTo("VOTING");
    runVote(g, { p2: SKIP, p3: SKIP, p4: SKIP }); // everyone else abstains: skipped
    g.advanceTo("NIGHT");
    // night 2: the Bodyguard takes the hit for p5
    g.nightAct("p1", "p5");
    g.nightAct("p4", "p5");
    g.advanceTo("VOTING");
    for (const id of ["p2", "p3", "p5", "p6", "p7"]) g.vote(id, "p1");
    g.advanceTo("GAME_OVER");

    const timeline = getGameView(g.state, "p6").timeline;
    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.night).toMatchObject({
      mafiaTargetId: "p5",
      protectedId: "p5",
      outcome: "saved",
      investigation: { targetId: "p1", isMafia: true },
      deaths: [],
    });
    expect(timeline[0]?.vote).toMatchObject({ outcome: "skipped", deaths: [] });
    expect(timeline[1]?.night).toMatchObject({ outcome: "guarded", guardedId: "p5" });
    expect(timeline[1]?.night.deaths.map((d) => d.playerId)).toEqual(["p4"]);
    expect(timeline[1]?.vote).toMatchObject({ outcome: "eliminated", deaths: [{ playerId: "p1", role: "mafia" }] });
  });

  it("notes the Mafia choosing no one", () => {
    const g = gameWithRoles(R8);
    runNight(g, []);
    g.advanceTo("VOTING");
    g.endPhase();
    g.endPhase();
    g.advanceTo("NIGHT");
    expect(g.state.history[0]?.night.outcome).toBe("no_attack");
  });
});
