import { SKIP, type Role } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { getGameView } from "./view.js";
import { evaluateWinner } from "./win.js";
import { R7, R8, gameWithRoles, runNight, runVote, type Game } from "./testing/harness.js";

/** Lets the results screen run out and returns the final phase. */
function finish(g: Game): void {
  g.endPhase();
}

describe("evaluateWinner", () => {
  it("is null while town outnumbers a living Mafia", () => {
    expect(evaluateWinner(gameWithRoles(R7).state)).toBeNull();
  });

  it("is town when no Mafia are alive", () => {
    const g = gameWithRoles(R7);
    g.kill("p1");
    expect(evaluateWinner(g.state)).toBe("town");
  });

  it("is mafia when they equal or outnumber everyone else", () => {
    const equal = gameWithRoles(R7);
    equal.kill("p3", "p4", "p5", "p6", "p7"); // p1 mafia vs p2
    expect(evaluateWinner(equal.state)).toBe("mafia");

    const more = gameWithRoles(R8);
    more.kill("p3", "p4", "p5", "p6", "p7", "p8"); // two mafia vs nobody
    expect(evaluateWinner(more.state)).toBe("mafia");
  });

  it("counts the Jester as one of 'everyone else'", () => {
    const roles: Role[] = ["mafia", "jester", "villager", "villager", "villager"];
    const g = gameWithRoles(roles);
    g.kill("p4", "p5"); // mafia, jester, villager
    expect(evaluateWinner(g.state)).toBeNull();
    g.kill("p3"); // mafia vs jester
    expect(evaluateWinner(g.state)).toBe("mafia");
  });
});

describe("Town wins", () => {
  it("when the last Mafia is voted out", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    runVote(g, { p2: "p1", p3: "p1", p4: "p1", p5: "p1", p6: "p1", p7: "p1" });
    expect(g.phase).toBe("VOTE_RESULTS");
    // the winner is announced after the results screen, and not before
    expect(g.state.winner).toBeNull();
    finish(g);
    expect(g.phase).toBe("GAME_OVER");
    expect(g.state.winner).toBe("town");
    expect(g.state.phaseEndsAt).toBeNull();
  });

  it("only once every Mafia is gone, over several rounds", () => {
    const g = gameWithRoles(R8);
    runNight(g, [
      ["p1", "p8"],
      ["p2", "p8"],
    ]);
    g.advanceTo("VOTING");
    runVote(g, { p2: "p1", p3: "p1", p4: "p1", p5: "p1", p6: "p1", p7: "p1" });
    expect(g.state.pendingWinner).toBeNull();
    g.advanceTo("NIGHT");
    expect(g.state.round).toBe(2);

    runNight(g, [["p2", "p7"]]);
    g.advanceTo("VOTING");
    runVote(g, { p3: "p2", p4: "p2", p5: "p2", p6: "p2", p2: SKIP });
    finish(g);
    expect(g.phase).toBe("GAME_OVER");
    expect(g.state.winner).toBe("town");
  });

  it("even if a Jester is still alive", () => {
    const roles: Role[] = ["mafia", "doctor", "detective", "jester", "villager", "villager", "villager"];
    const g = gameWithRoles(roles);
    g.advanceTo("VOTING");
    runVote(g, { p2: "p1", p3: "p1", p4: "p1", p5: "p1", p6: "p1", p7: "p1" });
    finish(g);
    expect(g.state.winner).toBe("town");
    expect(getGameView(g.state, "p5").winnerIds).toEqual(["p2", "p3", "p5", "p6", "p7"]);
  });

  it("when a night's heartbreak takes the last Mafia", () => {
    const roles: Role[] = ["mafia", "doctor", "detective", "cupid", "villager", "villager", "villager"];
    const g = gameWithRoles(roles);
    g.nightAct("p4", "p1", "p5");
    runNight(g, [["p1", "p5"]]);
    expect(g.state.nightReport?.deaths).toEqual([
      { playerId: "p5", cause: "mafia" },
      { playerId: "p1", cause: "heartbreak" },
    ]);
    finish(g);
    expect(g.state.winner).toBe("town");
  });
});

describe("Mafia wins", () => {
  it("when the night's kill makes them equal", () => {
    const g = gameWithRoles(R7);
    g.kill("p4", "p5", "p6", "p7"); // p1 mafia vs p2, p3
    runNight(g, [["p1", "p3"]]);
    expect(g.phase).toBe("NIGHT_RESULTS");
    finish(g);
    expect(g.phase).toBe("GAME_OVER");
    expect(g.state.winner).toBe("mafia");
  });

  it("is not triggered by a save", () => {
    const g = gameWithRoles(R7);
    g.kill("p4", "p5", "p6", "p7");
    runNight(g, [
      ["p1", "p3"],
      ["p2", "p3"],
    ]);
    finish(g);
    expect(g.phase).toBe("DAY_DISCUSSION");
  });

  it("when the day's vote makes them equal", () => {
    const g = gameWithRoles(R7);
    g.kill("p4", "p5", "p6", "p7");
    runNight(g, []);
    finish(g);
    g.advanceTo("VOTING");
    runVote(g, { p1: "p2", p3: "p2" });
    finish(g);
    expect(g.state.winner).toBe("mafia");
    expect(getGameView(g.state, "p2").winnerIds).toEqual(["p1"]);
  });
});

describe("Jester wins", () => {
  const roles: Role[] = ["mafia", "doctor", "detective", "jester", "villager", "villager", "villager"];

  it("instantly when voted out, alone", () => {
    const g = gameWithRoles(roles);
    g.advanceTo("VOTING");
    runVote(g, { p1: "p4", p2: "p4", p3: "p4", p5: "p4", p6: "p4", p7: "p4" });
    expect(g.state.pendingWinner).toBe("jester");
    finish(g);
    expect(g.phase).toBe("GAME_OVER");
    expect(g.state.winner).toBe("jester");
    const view = getGameView(g.state, "p1");
    expect(view.winnerIds).toEqual(["p4"]);
  });

  it("beats a Mafia parity caused by the same vote", () => {
    const g = gameWithRoles(roles);
    g.kill("p3", "p5", "p6", "p7"); // p1 mafia, p2 doctor, p4 jester
    runNight(g, []);
    finish(g);
    g.advanceTo("VOTING");
    runVote(g, { p1: "p4", p2: "p4" });
    finish(g);
    expect(g.state.winner).toBe("jester");
  });

  it("beats Town even if the vote also removes the last Mafia through a link", () => {
    const g = gameWithRoles(["mafia", "doctor", "detective", "jester", "cupid", "villager", "villager"]);
    g.nightAct("p5", "p4", "p1"); // Cupid links the Jester with the only Mafia
    runNight(g, []);
    finish(g);
    g.advanceTo("VOTING");
    runVote(g, { p1: "p4", p2: "p4", p3: "p4", p5: "p4", p6: "p4", p7: "p4" });
    expect(g.player("p1").alive).toBe(false);
    finish(g);
    expect(g.state.winner).toBe("jester");
  });

  it("doesn't win by dying at night", () => {
    const g = gameWithRoles(roles);
    runNight(g, [["p1", "p4"]]);
    expect(g.state.pendingWinner).toBeNull();
    finish(g);
    expect(g.phase).toBe("DAY_DISCUSSION");
  });
});

describe("after the game", () => {
  it("accepts no more play and reveals every role", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    runVote(g, { p2: "p1", p3: "p1", p4: "p1", p5: "p1", p6: "p1", p7: "p1" });
    finish(g);
    expect(g.fail({ type: "CAST_VOTE", playerId: "p2", targetId: SKIP })).toBe("WRONG_PHASE");
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p1", targetId: "p2" })).toBe("WRONG_PHASE");
    const before = g.state;
    g.ok({ type: "TICK" });
    expect(g.state.phase).toBe("GAME_OVER");
    expect(before.winner).toBe("town");

    const view = getGameView(g.state, "p4");
    expect(view.players.map((p) => p.role)).toEqual(R7);
  });
});
