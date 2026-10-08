import { describe, expect, it } from "vitest";
import { getGameView } from "./view.js";
import { R12, R7, R8, gameWithRoles, runNight, type Game } from "./testing/harness.js";
import type { Role } from "@mafia/shared";

const deaths = (g: Game) => g.state.nightReport?.deaths ?? [];
const alive = (g: Game, id: string) => g.player(id).alive;

/** Plays to the next night without anyone being eliminated by the day vote. */
function nextNight(g: Game): void {
  g.advanceTo("VOTING");
  g.endPhase(); // nobody voted: everyone counts as skip
  g.endPhase();
  expect(g.phase).toBe("NIGHT");
}

describe("Mafia kill", () => {
  it("kills the player the Mafia chose", () => {
    const g = gameWithRoles(R7);
    runNight(g, [["p1", "p4"]]);
    expect(deaths(g)).toEqual([{ playerId: "p4", cause: "mafia" }]);
    expect(alive(g, "p4")).toBe(false);
    expect(g.phase).toBe("NIGHT_RESULTS");
  });

  it("kills nobody if the Mafia don't vote", () => {
    const g = gameWithRoles(R7);
    runNight(g, []);
    expect(deaths(g)).toEqual([]);
  });

  it("can't target a teammate, a dead player, or be used by other roles", () => {
    const g = gameWithRoles(R8);
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p1", targetId: "p2" })).toBe("INVALID_TARGET");
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p1", targetId: "nobody" })).toBe("INVALID_TARGET");
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p5", targetId: "p6" })).toBe("NO_ABILITY");
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "ghost", targetId: "p6" })).toBe("NOT_IN_GAME");
  });

  it("goes with the majority when the Mafia disagree", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = gameWithRoles(R12, { seed });
      runNight(g, [
        ["p1", "p6"],
        ["p2", "p6"],
        ["p3", "p7"],
      ]);
      expect(deaths(g).map((d) => d.playerId)).toEqual(["p6"]);
    }
  });

  it("breaks a tie at random, only between the tied targets", () => {
    const victims = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const g = gameWithRoles(R8, { seed });
      runNight(g, [
        ["p1", "p5"],
        ["p2", "p6"],
      ]);
      expect(deaths(g)).toHaveLength(1);
      victims.add(deaths(g)[0]?.playerId ?? "");
    }
    expect([...victims].sort()).toEqual(["p5", "p6"]);
  });

  it("lets a Mafia member change their vote before the night ends", () => {
    const g = gameWithRoles(R8);
    g.nightAct("p1", "p5");
    g.nightAct("p1", "p6");
    g.nightAct("p2", "p6");
    g.endPhase();
    expect(deaths(g).map((d) => d.playerId)).toEqual(["p6"]);
  });
});

describe("Doctor", () => {
  it("saves the player the Mafia attacked", () => {
    const g = gameWithRoles(R7);
    runNight(g, [
      ["p1", "p4"],
      ["p2", "p4"],
    ]);
    expect(deaths(g)).toEqual([]);
    expect(alive(g, "p4")).toBe(true);
  });

  it("doesn't save anyone else", () => {
    const g = gameWithRoles(R7);
    runNight(g, [
      ["p1", "p4"],
      ["p2", "p5"],
    ]);
    expect(deaths(g).map((d) => d.playerId)).toEqual(["p4"]);
    expect(alive(g, "p5")).toBe(true);
  });

  it("can protect themself", () => {
    const g = gameWithRoles(R7);
    runNight(g, [
      ["p1", "p2"],
      ["p2", "p2"],
    ]);
    expect(deaths(g)).toEqual([]);
    expect(alive(g, "p2")).toBe(true);
  });

  it("can't protect the same person two nights in a row", () => {
    const g = gameWithRoles(R7);
    runNight(g, [["p2", "p4"]]);
    nextNight(g);
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p2", targetId: "p4" })).toBe("REPEAT_PROTECTION");
    // the view only offers legal targets
    const options = getGameView(g.state, "p2").you?.nightAction?.validTargetIds ?? [];
    expect(options).not.toContain("p4");
    expect(options).toContain("p2");
    g.nightAct("p2", "p5");
    expect(g.state.night.protect).toBe("p5");
  });

  it("may protect the same person again after skipping a night", () => {
    const g = gameWithRoles(R7);
    runNight(g, [["p2", "p4"]]);
    nextNight(g);
    runNight(g, []); // doctor does nothing
    nextNight(g);
    g.nightAct("p2", "p4");
    expect(g.state.night.protect).toBe("p4");
  });

  it("doesn't announce the save: a saved night looks like a quiet one", () => {
    const saved = gameWithRoles(R7);
    runNight(saved, [
      ["p1", "p4"],
      ["p2", "p4"],
    ]);
    const quiet = gameWithRoles(R7);
    runNight(quiet, []);
    expect(saved.state.nightReport).toEqual(quiet.state.nightReport);
  });
});

describe("Detective", () => {
  it("learns whether a target is Mafia", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p3", "p1");
    g.endPhase();
    expect(g.state.investigations).toEqual([{ round: 1, targetId: "p1", isMafia: true }]);

    nextNight(g);
    g.nightAct("p3", "p5");
    g.endPhase();
    expect(g.state.investigations.map((i) => [i.targetId, i.isMafia])).toEqual([
      ["p1", true],
      ["p5", false],
    ]);
    expect(g.state.investigations[1]?.round).toBe(2);
  });

  it("sees the Jester and the Doctor as not Mafia", () => {
    const roles: Role[] = ["mafia", "doctor", "detective", "jester", "villager", "villager", "villager"];
    const g = gameWithRoles(roles);
    g.nightAct("p3", "p4");
    g.endPhase();
    expect(g.state.investigations[0]?.isMafia).toBe(false);
  });

  it("keeps results private to the Detective", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p3", "p1");
    g.endPhase();
    expect(getGameView(g.state, "p3").you?.investigations).toEqual([{ round: 1, targetId: "p1", isMafia: true }]);
    for (const other of ["p1", "p2", "p4", "p7"]) {
      expect(getGameView(g.state, other).you?.investigations).toEqual([]);
    }
  });

  it("can't investigate themself", () => {
    const g = gameWithRoles(R7);
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p3", targetId: "p3" })).toBe("INVALID_TARGET");
  });
});

describe("Bodyguard", () => {
  const roles: Role[] = ["mafia", "doctor", "detective", "bodyguard", "villager", "villager", "villager"];

  it("dies in place of the player they guard", () => {
    const g = gameWithRoles(roles);
    runNight(g, [
      ["p1", "p5"],
      ["p4", "p5"],
    ]);
    expect(deaths(g)).toEqual([{ playerId: "p4", cause: "mafia" }]);
    expect(alive(g, "p5")).toBe(true);
  });

  it("isn't needed when the Doctor already saved the target", () => {
    const g = gameWithRoles(roles);
    runNight(g, [
      ["p1", "p5"],
      ["p2", "p5"],
      ["p4", "p5"],
    ]);
    expect(deaths(g)).toEqual([]);
    expect(alive(g, "p4")).toBe(true);
  });

  it("does nothing if someone else is attacked", () => {
    const g = gameWithRoles(roles);
    runNight(g, [
      ["p1", "p6"],
      ["p4", "p5"],
    ]);
    expect(deaths(g).map((d) => d.playerId)).toEqual(["p6"]);
    expect(alive(g, "p4")).toBe(true);
  });

  it("can't guard themself", () => {
    const g = gameWithRoles(roles);
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p4", targetId: "p4" })).toBe("INVALID_TARGET");
  });
});

describe("Cupid", () => {
  const roles: Role[] = ["mafia", "doctor", "detective", "cupid", "villager", "villager", "villager"];


  it("needs two different living players", () => {
    const g = gameWithRoles(roles);
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p4", targetId: "p5" })).toBe("INVALID_TARGET");
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p4", targetId: "p5", secondTargetId: "p5" })).toBe(
      "INVALID_TARGET",
    );
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p4", targetId: "p5", secondTargetId: "x" })).toBe(
      "INVALID_TARGET",
    );
  });

  it("makes the partner die of a broken heart", () => {
    const g = gameWithRoles(roles);
    g.nightAct("p4", "p5", "p6");
    runNight(g, [["p1", "p5"]]);
    expect(deaths(g)).toEqual([
      { playerId: "p5", cause: "mafia" },
      { playerId: "p6", cause: "heartbreak" },
    ]);
    expect(g.state.lovers).toEqual(["p5", "p6"]);
  });

  it("works the other way round, and when Cupid links themself", () => {
    const g = gameWithRoles(roles);
    g.nightAct("p4", "p4", "p6");
    runNight(g, [["p1", "p6"]]);
    expect(deaths(g).map((d) => d.playerId).sort()).toEqual(["p4", "p6"]);
  });

  it("doesn't kill the partner if the Doctor saved the victim", () => {
    const g = gameWithRoles(roles);
    g.nightAct("p4", "p5", "p6");
    runNight(g, [
      ["p1", "p5"],
      ["p2", "p5"],
    ]);
    expect(deaths(g)).toEqual([]);
  });

  it("only links on the first night", () => {
    const g = gameWithRoles(roles);
    runNight(g, []);
    nextNight(g);
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p4", targetId: "p5", secondTargetId: "p6" })).toBe(
      "NO_ABILITY",
    );
  });

  it("tells only Cupid and the lovers who is linked", () => {
    const g = gameWithRoles(roles);
    g.nightAct("p4", "p5", "p6");
    g.endPhase();
    for (const id of ["p4", "p5", "p6"]) expect(getGameView(g.state, id).you?.loverIds).toEqual(["p5", "p6"]);
    for (const id of ["p1", "p2", "p3", "p7"]) expect(getGameView(g.state, id).you?.loverIds).toBeNull();
  });
});
