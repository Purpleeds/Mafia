import { MAX_PLAYERS, VOTE_LAST_CALL_SECONDS } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { getGameView } from "./view.js";
import { AVATAR, Game, R7, gameWithRoles, lobby, runNight } from "./testing/harness.js";

describe("lobby", () => {
  it("makes the first player the host", () => {
    const g = lobby(3);
    expect(g.state.hostId).toBe("p1");
  });

  it("cleans names and rejects bad or duplicate ones", () => {
    const g = new Game();
    g.ok({ type: "JOIN", playerId: "a", name: "  Ana   Maria ", avatar: AVATAR });
    expect(g.player("a").name).toBe("Ana Maria");
    expect(g.fail({ type: "JOIN", playerId: "b", name: "ana maria", avatar: AVATAR })).toBe("NAME_TAKEN");
    expect(g.fail({ type: "JOIN", playerId: "b", name: "   ", avatar: AVATAR })).toBe("INVALID_NAME");
    expect(g.fail({ type: "JOIN", playerId: "b", name: "x".repeat(17), avatar: AVATAR })).toBe("INVALID_NAME");
    expect(g.fail({ type: "JOIN", playerId: "b", name: "bell\u0007", avatar: AVATAR })).toBe("INVALID_NAME");
    expect(g.fail({ type: "JOIN", playerId: "a", name: "Other", avatar: AVATAR })).toBe("ALREADY_JOINED");
  });

  it("accepts 16-character names in any alphabet, with basic punctuation", () => {
    const g = new Game();
    for (const [id, name] of [["a", "x".repeat(16)], ["b", "Zoë O'Neil-Smith"], ["c", "李雷"], ["d", "Mr. T (again)!"]]) {
      g.ok({ type: "JOIN", playerId: id ?? "", name: name ?? "", avatar: AVATAR });
    }
    for (const name of ["🙂 Smiley", "<b>bold</b>", "a/b", "shit happens"]) {
      expect(g.fail({ type: "JOIN", playerId: "e", name, avatar: AVATAR })).toBe("INVALID_NAME");
    }
  });

  it("needs a real avatar", () => {
    const g = new Game();
    const bad = [
      { color: "plaid", seed: "fox" },
      { color: "teal", seed: "Has Spaces" },
      { color: "teal", seed: "x".repeat(17) },
      { color: "teal" },
      null,
    ];
    for (const avatar of bad) {
      expect(
        g.fail({ type: "JOIN", playerId: "a", name: "Ana", avatar: avatar as unknown as typeof AVATAR }),
      ).toBe("INVALID_AVATAR");
    }
  });

  it("rejects ids that could clash with ballots or object keys", () => {
    const g = new Game();
    for (const id of ["skip", "__proto__", "", "has space", "-lead"]) {
      expect(g.fail({ type: "JOIN", playerId: id, name: "Name", avatar: AVATAR })).toBe("INVALID_ID");
    }
  });

  it("holds at most 20 players; anyone joining mid-game watches as a spectator", () => {
    const g = lobby(MAX_PLAYERS);
    expect(g.fail({ type: "JOIN", playerId: "late", name: "Late", avatar: AVATAR })).toBe("ROOM_FULL");
    g.ok({ type: "START_GAME", playerId: "p1" });
    g.ok({ type: "JOIN", playerId: "late", name: "Late", avatar: AVATAR });
    expect(g.state.players).toHaveLength(MAX_PLAYERS);
    expect(g.state.spectators.map((s) => s.id)).toEqual(["late"]);
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

  it("gives a last call once every living player has voted, and lets them change their mind until the timer ends", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    const fullTime = g.state.phaseEndsAt;
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6"]) g.vote(id, "skip");
    g.vote("p1", "p7"); // change of mind
    expect(g.state.voting?.ballots["p1"]).toBe("p7");
    expect(g.phase).toBe("VOTING");
    expect(g.state.phaseEndsAt).toBe(fullTime);
    expect(getGameView(g.state, "p2").voting?.lastCall).toBe(false);

    g.vote("p7", "skip");
    // Everyone has voted: voting stays open for the last call (10 s), not the full timer.
    expect(g.phase).toBe("VOTING");
    expect(g.state.phaseEndsAt).toBe(g.now + VOTE_LAST_CALL_SECONDS * 1000);
    expect(getGameView(g.state, "p2").voting?.lastCall).toBe(true);

    // A change during the last call still counts, and doesn't extend it.
    g.now += 4000;
    g.vote("p2", "p7");
    expect(g.state.phaseEndsAt).toBe(g.now - 4000 + VOTE_LAST_CALL_SECONDS * 1000);
    g.endPhase();
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(g.state.voteReport?.tally).toEqual({ p7: 2, skip: 5 });
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
