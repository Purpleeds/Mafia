import { describe, expect, it } from "vitest";
import { canRead, canWrite } from "./chat.js";
import { R7, gameWithRoles, lobby, runNight } from "./testing/harness.js";

describe("chat permissions", () => {
  it("lets everyone talk in the lobby", () => {
    const g = lobby(5);
    expect(canWrite(g.state, "p2", "public")).toBe(true);
    expect(canWrite(g.state, "p2", "mafia")).toBe(false);
    expect(canWrite(g.state, "p2", "graveyard")).toBe(false);
  });

  it("is silent at night except for the Mafia", () => {
    const g = gameWithRoles(R7);
    expect(canWrite(g.state, "p4", "public")).toBe(false);
    expect(canWrite(g.state, "p1", "public")).toBe(false);
    expect(canWrite(g.state, "p1", "mafia")).toBe(true);
    expect(canRead(g.state, "p1", "mafia")).toBe(true);
    for (const id of ["p2", "p3", "p4"]) {
      expect(canWrite(g.state, id, "mafia")).toBe(false);
      expect(canRead(g.state, id, "mafia")).toBe(false);
    }
  });

  it("closes the Mafia channel by day", () => {
    const g = gameWithRoles(R7);
    runNight(g, []);
    g.advanceTo("DAY_DISCUSSION");
    expect(canWrite(g.state, "p1", "mafia")).toBe(false);
    expect(canWrite(g.state, "p1", "public")).toBe(true);
    g.advanceTo("VOTING");
    expect(canWrite(g.state, "p4", "public")).toBe(true);
  });

  it("lets eliminated players watch but not talk to the living", () => {
    const g = gameWithRoles(R7);
    runNight(g, [["p1", "p4"]]); // p4 dies
    g.advanceTo("DAY_DISCUSSION");
    expect(canWrite(g.state, "p4", "public")).toBe(false);
    expect(canRead(g.state, "p4", "public")).toBe(true);
    // they have their own channel the living can't see or use
    expect(canWrite(g.state, "p4", "graveyard")).toBe(true);
    expect(canRead(g.state, "p4", "graveyard")).toBe(true);
    expect(canWrite(g.state, "p5", "graveyard")).toBe(false);
    expect(canRead(g.state, "p5", "graveyard")).toBe(false);
  });

  it("shuts a dead Mafia member out of the Mafia channel", () => {
    const g = gameWithRoles(R7);
    g.kill("p1");
    expect(canWrite(g.state, "p1", "mafia")).toBe(false);
    expect(canRead(g.state, "p1", "mafia")).toBe(false);
  });

  it("opens public chat to everyone after the game", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    for (const id of ["p2", "p3", "p4", "p5", "p6", "p7"]) g.vote(id, "p1");
    g.endPhase();
    g.endPhase();
    expect(g.phase).toBe("GAME_OVER");
    expect(canWrite(g.state, "p1", "public")).toBe(true);
    expect(canRead(g.state, "p1", "graveyard")).toBe(false);
  });

  it("ignores strangers", () => {
    const g = lobby(5);
    expect(canWrite(g.state, "ghost", "public")).toBe(false);
    expect(canRead(g.state, "ghost", "public")).toBe(false);
  });
});
