import { MAX_PLAYERS } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { R7, gameWithRoles, lobby, runNight } from "./testing/harness.js";
import { Game } from "./testing/harness.js";

describe("lobby", () => {
  it("makes the first player the host", () => {
    const g = lobby(3);
    expect(g.state.hostId).toBe("p1");
  });

  it("cleans names and rejects bad or duplicate ones", () => {
    const g = new Game();
    g.ok({ type: "JOIN", playerId: "a", name: "  Ana   Maria \u0007" });
    expect(g.player("a").name).toBe("Ana Maria");
    expect(g.fail({ type: "JOIN", playerId: "b", name: "ana maria" })).toBe("NAME_TAKEN");
    expect(g.fail({ type: "JOIN", playerId: "b", name: "   " })).toBe("INVALID_NAME");
    expect(g.fail({ type: "JOIN", playerId: "b", name: "x".repeat(21) })).toBe("INVALID_NAME");
    expect(g.fail({ type: "JOIN", playerId: "a", name: "Other" })).toBe("ALREADY_JOINED");
  });

  it("rejects ids that could clash with ballots or object keys", () => {
    const g = new Game();
    for (const id of ["skip", "__proto__", "", "has space", "-lead"]) {
      expect(g.fail({ type: "JOIN", playerId: id, name: "Name" })).toBe("INVALID_ID");
    }
  });

  it("holds at most 20 players and nobody joins mid-game", () => {
    const g = lobby(MAX_PLAYERS);
    expect(g.fail({ type: "JOIN", playerId: "late", name: "Late" })).toBe("ROOM_FULL");
    g.ok({ type: "START_GAME", playerId: "p1" });
    g.ok({ type: "LEAVE", playerId: "p20" });
    expect(g.fail({ type: "JOIN", playerId: "late", name: "Late" })).toBe("WRONG_PHASE");
  });

  it("lets only the host change valid settings, in the lobby", () => {
    const g = lobby(5);
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p2", settings: { tieRule: "revote" } })).toBe("NOT_HOST");
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { timers: { nightSeconds: 5 } } })).toBe(
      "INVALID_SETTINGS",
    );
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { mafiaCount: 0 } })).toBe("INVALID_SETTINGS");
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { bogus: 1 } })).toBe("INVALID_SETTINGS");
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: "nope" })).toBe("INVALID_SETTINGS");
    // a patch with one bad field changes nothing
    expect(
      g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { tieRule: "revote", mafiaCount: 99 } }),
    ).toBe("INVALID_SETTINGS");
    expect(g.state.settings.tieRule).toBe("no_elimination");

    g.ok({
      type: "UPDATE_SETTINGS",
      playerId: "p1",
      settings: { tieRule: "revote", revealRoleOnDeath: false, timers: { nightSeconds: 45, discussionSeconds: 90 } },
    });
    expect(g.state.settings).toMatchObject({ tieRule: "revote", revealRoleOnDeath: false });
    expect(g.state.settings.timers).toMatchObject({ nightSeconds: 45, discussionSeconds: 90, votingSeconds: 45 });

    g.ok({ type: "START_GAME", playerId: "p1" });
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { tieRule: "no_elimination" } })).toBe(
      "WRONG_PHASE",
    );
  });

  it("stores the content mode (safe by default) without changing the rules", () => {
    const g = lobby(5);
    expect(g.state.settings.contentMode).toBe("safe");
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "normal" } });
    expect(g.state.settings.contentMode).toBe("normal");
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "spicy" } })).toBe(
      "INVALID_SETTINGS",
    );
  });

  it("needs the host and at least five players to start", () => {
    const four = lobby(4);
    expect(four.fail({ type: "START_GAME", playerId: "p1" })).toBe("NOT_ENOUGH_PLAYERS");
    const five = lobby(5);
    expect(five.fail({ type: "START_GAME", playerId: "p2" })).toBe("NOT_HOST");
    five.ok({ type: "START_GAME", playerId: "p1" });
    expect(five.phase).toBe("ROLE_REVEAL");
  });
});

describe("phase machine", () => {
  it("walks every phase with the configured timers", () => {
    const g = lobby(7);
    g.ok({
      type: "UPDATE_SETTINGS",
      playerId: "p1",
      settings: {
        timers: {
          roleRevealSeconds: 6,
          nightSeconds: 20,
          nightResultsSeconds: 4,
          discussionSeconds: 60,
          votingSeconds: 30,
          voteResultsSeconds: 5,
        },
      },
    });
    const t0 = g.now;
    g.ok({ type: "START_GAME", playerId: "p1" });
    expect(g.phase).toBe("ROLE_REVEAL");
    expect(g.state.phaseEndsAt).toBe(t0 + 6_000);

    // not yet
    g.now = t0 + 5_999;
    g.ok({ type: "TICK" });
    expect(g.phase).toBe("ROLE_REVEAL");

    const expected: Array<[string, number]> = [
      ["NIGHT", 20],
      ["NIGHT_RESULTS", 4],
      ["DAY_DISCUSSION", 60],
      ["VOTING", 30],
      ["VOTE_RESULTS", 5],
      ["NIGHT", 20],
    ];
    for (const [phase, seconds] of expected) {
      g.endPhase();
      expect(g.phase).toBe(phase);
      expect(g.state.phaseEndsAt).toBe(g.now + seconds * 1000);
    }
    expect(g.state.round).toBe(2);
  });

  it("ends role reveal as soon as everyone has looked", () => {
    const g = lobby(5);
    g.ok({ type: "START_GAME", playerId: "p1" });
    for (const id of ["p1", "p2", "p3", "p4"]) g.ok({ type: "ACK_ROLE", playerId: id });
    expect(g.phase).toBe("ROLE_REVEAL");
    g.ok({ type: "ACK_ROLE", playerId: "p5" });
    expect(g.phase).toBe("NIGHT");
  });

  it("ends the night once every player with an ability has acted", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p1", "p4");
    g.nightAct("p2", "p5");
    expect(g.phase).toBe("NIGHT");
    g.nightAct("p3", "p1");
    expect(g.phase).toBe("NIGHT_RESULTS");
  });

  it("ends the vote once every living player has voted, and lets them change their mind", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6"]) g.vote(id, "skip");
    g.vote("p1", "p7"); // change of mind
    expect(g.state.voting?.ballots["p1"]).toBe("p7");
    expect(g.phase).toBe("VOTING");
    g.vote("p7", "skip");
    expect(g.phase).toBe("VOTE_RESULTS");
  });

  it("rejects actions in the wrong phase", () => {
    const g = gameWithRoles(R7);
    expect(g.fail({ type: "CAST_VOTE", playerId: "p1", targetId: "skip" })).toBe("WRONG_PHASE");
    expect(g.fail({ type: "ACK_ROLE", playerId: "p1" })).toBe("WRONG_PHASE");
    expect(g.fail({ type: "START_GAME", playerId: "p1" })).toBe("WRONG_PHASE");
    g.advanceTo("DAY_DISCUSSION");
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "p1", targetId: "p4" })).toBe("WRONG_PHASE");
  });

  it("doesn't let eliminated players act or vote", () => {
    const g = gameWithRoles(R7);
    runNight(g, [["p1", "p4"]]); // p4 dies
    expect(g.player("p4").alive).toBe(false);
    g.advanceTo("VOTING");
    expect(g.fail({ type: "CAST_VOTE", playerId: "p4", targetId: "skip" })).toBe("DEAD_PLAYER");
    expect(g.fail({ type: "CAST_VOTE", playerId: "p1", targetId: "p4" })).toBe("INVALID_TARGET");
  });

  it("never changes the state it is given", () => {
    const g = gameWithRoles(R7);
    const before = g.state;
    const snapshot = structuredClone(before);
    g.nightAct("p1", "p4");
    expect(before).toEqual(snapshot);
    expect(g.state).not.toBe(before);
  });

  it("starts a fresh lobby after the game, keeping settings and dropping absent players", () => {
    const g = gameWithRoles(R7, { settings: { tieRule: "revote" } });
    g.advanceTo("VOTING");
    for (const id of ["p2", "p3", "p4", "p5", "p6", "p7"]) g.vote(id, "p1");
    g.endPhase();
    g.endPhase();
    expect(g.phase).toBe("GAME_OVER");
    g.ok({ type: "DISCONNECT", playerId: "p7" });
    expect(g.fail({ type: "RESTART", playerId: "p2" })).toBe("NOT_HOST");
    g.ok({ type: "RESTART", playerId: "p1" });
    expect(g.phase).toBe("LOBBY");
    expect(g.state.players).toHaveLength(6);
    expect(g.state.players.every((p) => p.alive && p.role === null)).toBe(true);
    expect(g.state.winner).toBeNull();
    expect(g.state.settings.tieRule).toBe("revote");
  });
});
