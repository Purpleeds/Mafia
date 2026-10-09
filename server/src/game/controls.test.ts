import { ADD_TIME_SECONDS, MAX_PHASE_REMAINING_SECONDS, SKIP } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { R7, gameWithRoles, lobby, runNight } from "./testing/harness.js";
import { getGameView } from "./view.js";

describe("ready in the lobby", () => {
  it("lets each player say they're ready, shows it to everyone, and resets for the next game", () => {
    const g = lobby(5);
    g.ok({ type: "SET_READY", playerId: "p2", ready: true });
    expect(getGameView(g.state, "p1").players.find((p) => p.id === "p2")?.done).toBe(true);
    g.ok({ type: "SET_READY", playerId: "p2", ready: false });
    expect(getGameView(g.state, "p1").players.find((p) => p.id === "p2")?.done).toBe(false);
    g.ok({ type: "SET_READY", playerId: "p3", ready: true });
    g.ok({ type: "START_GAME", playerId: "p1" });
    expect(g.state.players.every((p) => !p.ready)).toBe(true);
    expect(g.fail({ type: "SET_READY", playerId: "p2", ready: true })).toBe("WRONG_PHASE");
  });

  it("counts games, so private notes can be kept per game", () => {
    const g = lobby(5);
    expect(getGameView(g.state, "p1").gameNumber).toBe(0);
    g.ok({ type: "START_GAME", playerId: "p1" });
    expect(getGameView(g.state, "p1").gameNumber).toBe(1);
  });
});

describe("the host's timer controls", () => {
  it("pauses: the timer freezes, nothing ends the phase, and resuming gives back the time that was left", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("DAY_DISCUSSION");
    const left = (g.state.phaseEndsAt ?? 0) - g.now;
    g.now += 10_000;
    g.ok({ type: "PAUSE", playerId: "p1" });
    expect(g.state.phaseEndsAt).toBeNull();
    expect(getGameView(g.state, "p4").paused).toEqual({ remainingMs: left - 10_000 });

    // Time passes and the timer fires: still the discussion.
    g.now += 10 * 60_000;
    g.ok({ type: "TICK" });
    expect(g.phase).toBe("DAY_DISCUSSION");
    // Everyone being done talking doesn't end it either while paused.
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) g.ok({ type: "SKIP_DISCUSSION", playerId: id, skip: true });
    expect(g.phase).toBe("DAY_DISCUSSION");

    // Everyone was done talking, so voting starts the moment the host resumes.
    g.ok({ type: "RESUME", playerId: "p1" });
    expect(g.phase).toBe("VOTING");
    expect(getGameView(g.state, "p4").paused).toBeNull();
  });

  it("resumes with the same time that was left", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("DAY_DISCUSSION");
    const left = (g.state.phaseEndsAt ?? 0) - g.now;
    g.ok({ type: "PAUSE", playerId: "p1" });
    g.now += 60_000;
    g.ok({ type: "RESUME", playerId: "p1" });
    expect(g.state.phaseEndsAt).toBe(g.now + left);
  });

  it("only lets the host pause, resume, add time or skip", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("DAY_DISCUSSION");
    for (const type of ["PAUSE", "RESUME", "ADD_TIME", "SKIP_TO_VOTING"] as const) {
      expect(g.fail({ type, playerId: "p2" }), type).toBe("NOT_HOST");
    }
  });

  it("adds 30 seconds, paused or not, up to 15 minutes left", () => {
    const g = gameWithRoles(R7);
    const before = g.state.phaseEndsAt ?? 0;
    g.ok({ type: "ADD_TIME", playerId: "p1" }); // at night
    expect(g.state.phaseEndsAt).toBe(before + ADD_TIME_SECONDS * 1000);
    g.ok({ type: "PAUSE", playerId: "p1" });
    const paused = g.state.paused?.remainingMs ?? 0;
    g.ok({ type: "ADD_TIME", playerId: "p1" });
    expect(g.state.paused?.remainingMs).toBe(paused + ADD_TIME_SECONDS * 1000);
    g.state.paused = { remainingMs: MAX_PHASE_REMAINING_SECONDS * 1000 - 10_000 };
    expect(g.fail({ type: "ADD_TIME", playerId: "p1" })).toBe("TIME_LIMIT");
  });

  it("skips to voting from the discussion only", () => {
    const g = gameWithRoles(R7);
    expect(g.fail({ type: "SKIP_TO_VOTING", playerId: "p1" })).toBe("WRONG_PHASE");
    g.advanceTo("DAY_DISCUSSION");
    g.ok({ type: "SKIP_TO_VOTING", playerId: "p1" });
    expect(g.phase).toBe("VOTING");
    expect(g.state.voting?.round).toBe(1);
  });

  it("has nothing to pause in the lobby or after the game", () => {
    const g = lobby(5);
    expect(g.fail({ type: "PAUSE", playerId: "p1" })).toBe("WRONG_PHASE");
    expect(g.fail({ type: "ADD_TIME", playerId: "p1" })).toBe("WRONG_PHASE");
  });
});

describe("done talking", () => {
  it("starts voting early once every player still in (and connected) is done", () => {
    const g = gameWithRoles(R7);
    runNight(g, [["p1", "p4"]]); // p4 leaves the game
    g.advanceTo("DAY_DISCUSSION");
    g.ok({ type: "DISCONNECT", playerId: "p7" });
    expect(g.fail({ type: "SKIP_DISCUSSION", playerId: "p4", skip: true })).toBe("DEAD_PLAYER");
    for (const id of ["p1", "p2", "p3", "p5"]) g.ok({ type: "SKIP_DISCUSSION", playerId: id, skip: true });
    expect(getGameView(g.state, "p2").discussion).toEqual({ doneCount: 4, needed: 5, youAreDone: true });
    // Changing your mind takes it back.
    g.ok({ type: "SKIP_DISCUSSION", playerId: "p5", skip: false });
    expect(getGameView(g.state, "p5").discussion).toMatchObject({ doneCount: 3, youAreDone: false });
    g.ok({ type: "SKIP_DISCUSSION", playerId: "p5", skip: true });
    expect(g.phase).toBe("DAY_DISCUSSION");
    g.ok({ type: "SKIP_DISCUSSION", playerId: "p6", skip: true });
    expect(g.phase).toBe("VOTING");
    expect(getGameView(g.state, "p2").log.at(-1)).toEqual({ kind: "discussion_skipped", round: 1, by: "players" });
  });

  it("is only for the discussion", () => {
    const g = gameWithRoles(R7);
    expect(g.fail({ type: "SKIP_DISCUSSION", playerId: "p2", skip: true })).toBe("WRONG_PHASE");
  });
});

describe("what's happened so far", () => {
  it("records only public events, the same for everyone, and starts afresh each game", () => {
    const g = gameWithRoles(R7, { settings: { revealRoleOnDeath: false, announceSaves: false } });
    g.nightAct("p1", "p4");
    g.nightAct("p2", "p4"); // the Doctor saves p4
    g.nightAct("p3", "p1"); // the Detective finds the Mafia
    if (g.phase === "NIGHT") g.endPhase();
    g.advanceTo("DAY_DISCUSSION");
    g.ok({ type: "PAUSE", playerId: "p1" });
    g.ok({ type: "RESUME", playerId: "p1" });
    g.ok({ type: "SKIP_TO_VOTING", playerId: "p1" });
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) g.vote(id, id === "p7" ? "p6" : "p7");
    g.endPhase();

    const views = ["p1", "p2", "p3", "p4"].map((id) => getGameView(g.state, id).log);
    for (const log of views) expect(log).toEqual(views[0]);
    const log = views[0] ?? [];
    expect(log.map((e) => e.kind)).toEqual(["night", "paused", "resumed", "discussion_skipped", "vote"]);
    // The save is secret (the host doesn't announce saves), and so are roles.
    expect(log[0]).toEqual({ kind: "night", round: 1, deaths: [], saved: false });
    expect(log[4]).toMatchObject({ kind: "vote", outcome: "eliminated", deaths: [{ playerId: "p7", cause: "vote", role: null }] });
    const text = JSON.stringify(log);
    expect(text).not.toMatch(/"role":"|mafia"|doctor|detective|investigat|protect/);
  });

  it("shows a save and a role when the host makes them public", () => {
    const g = gameWithRoles(R7, { settings: { revealRoleOnDeath: true, announceSaves: true } });
    g.nightAct("p1", "p4");
    g.nightAct("p2", "p4");
    if (g.phase === "NIGHT") g.endPhase();
    expect(getGameView(g.state, "p5").log[0]).toEqual({ kind: "night", round: 1, deaths: [], saved: true });
    g.advanceTo("VOTING");
    for (const id of ["p2", "p3", "p4", "p5", "p6"]) g.vote(id, "p1");
    g.vote("p1", SKIP);
    g.endPhase();
    expect(getGameView(g.state, "p5").log.at(-1)).toMatchObject({ kind: "vote", deaths: [{ playerId: "p1", role: "mafia" }] });
  });

  it("logs a removal by the host, and is empty in the lobby", () => {
    const g = gameWithRoles(R7);
    g.ok({ type: "KICK", playerId: "p1", targetId: "p6" });
    expect(getGameView(g.state, "p2").log).toEqual([{ kind: "kicked", round: 1, playerId: "p6" }]);
    expect(getGameView(lobby(5).state, "p1").log).toEqual([]);
  });
});
