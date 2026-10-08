import { SKIP } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { getGameView } from "./view.js";
import { evaluateWinner } from "./win.js";
import { R7, gameWithRoles, lobby, runVote } from "./testing/harness.js";

describe("disconnects in the lobby", () => {
  it("passes the host role to a connected player", () => {
    const g = lobby(5);
    g.ok({ type: "DISCONNECT", playerId: "p1" });
    expect(g.state.hostId).toBe("p2");
    g.ok({ type: "RECONNECT", playerId: "p1" });
    expect(g.state.hostId).toBe("p2"); // the old host doesn't take it back
    expect(g.fail({ type: "START_GAME", playerId: "p1" })).toBe("NOT_HOST");
  });

  it("gives the host role to whoever returns first if everyone dropped", () => {
    const g = lobby(5);
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) g.ok({ type: "DISCONNECT", playerId: id });
    g.ok({ type: "RECONNECT", playerId: "p4" });
    expect(g.state.hostId).toBe("p4");
  });

  it("leaves absent players behind when the game starts", () => {
    const g = lobby(6);
    g.ok({ type: "DISCONNECT", playerId: "p6" });
    g.ok({ type: "START_GAME", playerId: "p1" });
    expect(g.state.players.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("won't start if too few players are connected, and changes nothing", () => {
    const g = lobby(5);
    g.ok({ type: "DISCONNECT", playerId: "p5" });
    expect(g.fail({ type: "START_GAME", playerId: "p1" })).toBe("NOT_ENOUGH_PLAYERS");
    expect(g.phase).toBe("LOBBY");
    expect(g.state.players).toHaveLength(5);
  });

  it("removes a player who leaves on purpose", () => {
    const g = lobby(5);
    g.ok({ type: "LEAVE", playerId: "p1" });
    expect(g.state.players.map((p) => p.id)).toEqual(["p2", "p3", "p4", "p5"]);
    expect(g.state.hostId).toBe("p2");
  });
});

describe("disconnects during the game", () => {
  it("keeps the player, their role and their seat", () => {
    const g = gameWithRoles(R7);
    g.ok({ type: "DISCONNECT", playerId: "p3" });
    expect(g.player("p3")).toMatchObject({ alive: true, role: "detective", connected: false });
    g.ok({ type: "RECONNECT", playerId: "p3" });
    expect(getGameView(g.state, "p3").you?.role).toBe("detective");
  });

  it("treats leaving mid-game as a disconnect", () => {
    const g = gameWithRoles(R7);
    g.ok({ type: "LEAVE", playerId: "p4" });
    expect(g.player("p4")).toMatchObject({ alive: true, connected: false });
  });

  it("doesn't wait for a disconnected player at night", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p1", "p4");
    g.nightAct("p3", "p1");
    expect(g.phase).toBe("NIGHT"); // still waiting for the Doctor
    g.ok({ type: "DISCONNECT", playerId: "p2" });
    expect(g.phase).toBe("NIGHT_RESULTS");
    expect(g.state.nightReport?.deaths).toEqual([{ playerId: "p4", cause: "mafia" }]);
  });

  it("lets a reconnected player act again before the night ends", () => {
    const g = gameWithRoles(R7);
    g.ok({ type: "DISCONNECT", playerId: "p2" });
    g.nightAct("p1", "p4");
    g.ok({ type: "RECONNECT", playerId: "p2" });
    g.nightAct("p3", "p1");
    expect(g.phase).toBe("NIGHT"); // the Doctor is required again
    g.nightAct("p2", "p4");
    expect(g.phase).toBe("NIGHT_RESULTS");
    expect(g.state.nightReport?.deaths).toEqual([]);
  });

  it("keeps an action taken before disconnecting", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p2", "p4");
    g.ok({ type: "DISCONNECT", playerId: "p2" });
    g.nightAct("p1", "p4");
    g.nightAct("p3", "p1");
    expect(g.state.nightReport?.deaths).toEqual([]);
  });

  it("makes no kill when every Mafia member is gone", () => {
    const g = gameWithRoles(R7);
    g.ok({ type: "DISCONNECT", playerId: "p1" });
    g.nightAct("p2", "p4");
    g.nightAct("p3", "p5");
    expect(g.phase).toBe("NIGHT_RESULTS");
    expect(g.state.nightReport?.deaths).toEqual([]);
  });

  it("counts a Mafia vote cast before disconnecting", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p1", "p4");
    g.ok({ type: "DISCONNECT", playerId: "p1" });
    g.nightAct("p2", "p5");
    g.nightAct("p3", "p5");
    expect(g.state.nightReport?.deaths).toEqual([{ playerId: "p4", cause: "mafia" }]);
  });

  it("falls back to the timer when nobody who can act is connected", () => {
    const g = gameWithRoles(R7);
    for (const id of ["p1", "p2", "p3"]) g.ok({ type: "DISCONNECT", playerId: id });
    expect(g.phase).toBe("NIGHT");
    g.endPhase();
    expect(g.phase).toBe("NIGHT_RESULTS");
  });

  it("doesn't wait for disconnected players to look at their role", () => {
    const g = lobby(5);
    g.ok({ type: "START_GAME", playerId: "p1" });
    g.ok({ type: "DISCONNECT", playerId: "p5" });
    for (const id of ["p1", "p2", "p3", "p4"]) g.ok({ type: "ACK_ROLE", playerId: id });
    expect(g.phase).toBe("NIGHT");
  });

  it("doesn't wait for a disconnected voter, and doesn't count them as skip", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    g.ok({ type: "DISCONNECT", playerId: "p7" });
    // 3 for p4, 3 skip. If p7 were counted as skip, skip would win 4–3.
    for (const id of ["p1", "p2", "p3"]) g.vote(id, "p4");
    for (const id of ["p4", "p5", "p6"]) g.vote(id, SKIP);
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(g.state.voteReport?.outcome).toBe("tie");
  });

  it("keeps a ballot cast before disconnecting", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    g.vote("p7", "p4");
    g.ok({ type: "DISCONNECT", playerId: "p7" });
    runVote(g, { p1: "p4", p2: "p4", p3: SKIP, p4: SKIP, p5: SKIP });
    // p4: 3 (p7, p1, p2) vs skip: 3 (p3, p4, p5) + p6 abstained (connected) = 4 -> skipped
    expect(g.state.voteReport?.tally).toEqual({ p4: 3, skip: 4 });
  });

  it("still counts a disconnected player as alive for the win check", () => {
    const g = gameWithRoles(R7);
    g.ok({ type: "DISCONNECT", playerId: "p1" });
    expect(evaluateWinner(g.state)).toBeNull();
    g.advanceTo("VOTING");
    // town can still vote the absent Mafia out
    runVote(g, { p2: "p1", p3: "p1", p4: "p1", p5: "p1", p6: "p1", p7: "p1" });
    g.endPhase();
    expect(g.state.winner).toBe("town");
  });

  it("ignores the vote deadline when nobody is connected, but still follows the timer", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    for (const p of g.state.players) g.ok({ type: "DISCONNECT", playerId: p.id });
    expect(g.phase).toBe("VOTING");
    g.endPhase();
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(g.state.voteReport?.outcome).toBe("nobody");
  });
});
