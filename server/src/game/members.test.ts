import { MAX_PLAYERS, SKIP, type Role } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { canRead, canWrite } from "./chat.js";
import { getGameView } from "./view.js";
import { AVATAR, R7, gameWithRoles, lobby, runNight, type Game } from "./testing/harness.js";

const spectate = (g: Game, id = "late", name = "Late Lou") =>
  g.ok({ type: "JOIN", playerId: id, name, avatar: { color: "pink", seed: "owl" } });

describe("spectators", () => {
  it("are who joins once a game has started", () => {
    const g = gameWithRoles(R7);
    spectate(g);
    expect(g.state.spectators).toMatchObject([{ id: "late", name: "Late Lou", connected: true }]);
    expect(g.state.players).toHaveLength(7);
  });

  it("can't take part in the game", () => {
    const g = gameWithRoles(R7);
    spectate(g);
    expect(g.fail({ type: "NIGHT_ACTION", playerId: "late", targetId: "p4" })).toBe("SPECTATOR");
    g.advanceTo("VOTING");
    expect(g.fail({ type: "CAST_VOTE", playerId: "late", targetId: SKIP })).toBe("SPECTATOR");
    // and they don't hold up the vote
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) g.vote(id, SKIP);
    expect(g.phase).toBe("VOTE_RESULTS");
  });

  it("see only public information", () => {
    const g = gameWithRoles(R7, { settings: { revealRoleOnDeath: false } });
    spectate(g);
    g.nightAct("p1", "p4");
    const view = getGameView(g.state, "late");
    expect(view.you).toMatchObject({ id: "late", isSpectator: true, role: null, alive: false, isHost: false });
    expect(view.you?.nightAction).toBeNull();
    expect(view.players.every((p) => p.role === null)).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/"role":"/);
    expect(getGameView(g.state, "p2").spectators.map((s) => s.name)).toEqual(["Late Lou"]);
  });

  it("chat with the eliminated, never with the living", () => {
    const g = gameWithRoles(R7);
    spectate(g);
    runNight(g, [["p1", "p4"]]);
    g.advanceTo("DAY_DISCUSSION");
    expect(canWrite(g.state, "late", "public")).toBe(false);
    expect(canRead(g.state, "late", "public")).toBe(true);
    expect(canWrite(g.state, "late", "graveyard")).toBe(true);
    expect(canRead(g.state, "late", "mafia")).toBe(false);
  });

  it("can leave at any time", () => {
    const g = gameWithRoles(R7);
    spectate(g);
    g.ok({ type: "LEAVE", playerId: "late" });
    expect(g.state.spectators).toEqual([]);
  });

  it("become players at the next game, while there is room", () => {
    const g = gameWithRoles(R7);
    spectate(g, "s1", "First");
    spectate(g, "s2", "Second");
    g.ok({ type: "DISCONNECT", playerId: "s2" });
    g.advanceTo("VOTING");
    for (const id of ["p2", "p3", "p4", "p5", "p6", "p7"]) g.vote(id, "p1");
    g.advanceTo("GAME_OVER");
    g.ok({ type: "RESTART", playerId: "p1" });
    expect(g.state.players.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "s1"]);
    expect(g.player("s1")).toMatchObject({ role: null, alive: true, kicked: false, avatar: { color: "pink", seed: "owl" } });
    expect(g.state.spectators).toEqual([]); // s2 was away, so dropped
  });

  it("keep watching if the next game is full", () => {
    const g = lobby(MAX_PLAYERS);
    g.ok({ type: "START_GAME", playerId: "p1" });
    spectate(g);
    g.state.players[0]!.role = "villager";
    for (const p of g.state.players) if (p.role === "mafia") p.alive = false;
    g.state.phase = "GAME_OVER";
    g.state.phaseEndsAt = null;
    g.ok({ type: "RESTART", playerId: "p1" });
    expect(g.state.players).toHaveLength(MAX_PLAYERS);
    expect(g.state.spectators.map((s) => s.id)).toEqual(["late"]);
  });

  it("share the nickname space with players", () => {
    const g = gameWithRoles(R7);
    expect(g.fail({ type: "JOIN", playerId: "late", name: "player 1", avatar: AVATAR })).toBe("NAME_TAKEN");
  });
});

describe("kicking", () => {
  it("is for the host only, and not themself", () => {
    const g = lobby(5);
    expect(g.fail({ type: "KICK", playerId: "p2", targetId: "p3" })).toBe("NOT_HOST");
    expect(g.fail({ type: "KICK", playerId: "p1", targetId: "p1" })).toBe("INVALID_TARGET");
    expect(g.fail({ type: "KICK", playerId: "p1", targetId: "ghost" })).toBe("INVALID_TARGET");
  });

  it("removes a player from the lobby", () => {
    const g = lobby(5);
    g.ok({ type: "KICK", playerId: "p1", targetId: "p3" });
    expect(g.state.players.map((p) => p.id)).toEqual(["p1", "p2", "p4", "p5"]);
  });

  it("removes a spectator", () => {
    const g = gameWithRoles(R7);
    spectate(g);
    g.ok({ type: "KICK", playerId: "p1", targetId: "late" });
    expect(g.state.spectators).toEqual([]);
  });

  it("takes a player out of a running game as eliminated, keeping their seat in the list", () => {
    const g = gameWithRoles(R7);
    g.ok({ type: "KICK", playerId: "p1", targetId: "p5" });
    expect(g.player("p5")).toMatchObject({ kicked: true, alive: false, connected: false });
    expect(getGameView(g.state, "p2").players[4]).toMatchObject({ kicked: true, alive: false, connection: "offline" });
    expect(g.fail({ type: "RECONNECT", playerId: "p5" })).toBe("NOT_IN_GAME");
    expect(g.fail({ type: "KICK", playerId: "p1", targetId: "p5" })).toBe("INVALID_TARGET");
  });

  it("drops the kicked player's choices and any choices aimed at them", () => {
    const g = gameWithRoles(["mafia", "mafia", "doctor", "detective", "villager", "villager", "villager", "villager"]);
    g.nightAct("p1", "p5"); // kill vote aimed at p5
    g.nightAct("p2", "p6");
    g.nightAct("p3", "p5"); // doctor protects p5
    g.ok({ type: "KICK", playerId: "p1", targetId: "p5" });
    expect(g.state.night.mafiaVotes).toEqual({ p2: "p6" });
    expect(g.state.night.protect).toBeNull();
    g.ok({ type: "KICK", playerId: "p1", targetId: "p2" }); // a Mafia member
    expect(g.state.night.mafiaVotes).toEqual({});
  });

  it("ends the phase early if the kicked player was the one everyone was waiting for", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p1", "p4");
    g.nightAct("p3", "p1");
    expect(g.phase).toBe("NIGHT"); // waiting for the Doctor
    g.ok({ type: "KICK", playerId: "p1", targetId: "p2" });
    expect(g.phase).toBe("NIGHT_RESULTS");
  });

  it("removes ballots for and by the kicked player", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    g.vote("p2", "p5");
    g.vote("p5", "p3");
    g.ok({ type: "KICK", playerId: "p1", targetId: "p5" });
    expect(g.state.voting?.ballots).toEqual({});
  });

  it("doesn't take a linked partner with them", () => {
    const g = gameWithRoles(["mafia", "doctor", "detective", "cupid", "villager", "villager", "villager"]);
    g.nightAct("p4", "p5", "p6");
    g.ok({ type: "KICK", playerId: "p1", targetId: "p5" });
    expect(g.player("p6").alive).toBe(true);
  });
});

describe("kicking can decide the game", () => {
  it("town wins if the last Mafia is kicked", () => {
    const roles: Role[] = ["villager", "doctor", "detective", "mafia", "villager", "villager", "villager"];
    const g = gameWithRoles(roles);
    g.ok({ type: "KICK", playerId: "p1", targetId: "p4" });
    expect(g.phase).toBe("GAME_OVER");
    expect(g.state.winner).toBe("town");
    expect(g.state.phaseEndsAt).toBeNull();
  });

  it("Mafia win if kicking leaves them equal", () => {
    const g = gameWithRoles(R7);
    g.kill("p4", "p5", "p6", "p7"); // p1 mafia vs p2, p3
    g.ok({ type: "KICK", playerId: "p1", targetId: "p3" });
    expect(g.state.winner).toBe("mafia");
  });
});

describe("host", () => {
  it("can hand hosting to another connected player, in any phase", () => {
    const g = gameWithRoles(R7);
    expect(g.fail({ type: "TRANSFER_HOST", playerId: "p2", targetId: "p3" })).toBe("NOT_HOST");
    expect(g.fail({ type: "TRANSFER_HOST", playerId: "p1", targetId: "p1" })).toBe("INVALID_TARGET");
    g.ok({ type: "DISCONNECT", playerId: "p4" });
    expect(g.fail({ type: "TRANSFER_HOST", playerId: "p1", targetId: "p4" })).toBe("INVALID_TARGET");
    g.ok({ type: "TRANSFER_HOST", playerId: "p1", targetId: "p3" });
    expect(g.state.hostId).toBe("p3");
    expect(getGameView(g.state, "p3").you?.isHost).toBe(true);
  });

  it("passes to the next player in join order when the host disconnects", () => {
    const g = lobby(5);
    g.ok({ type: "TRANSFER_HOST", playerId: "p1", targetId: "p3" });
    g.ok({ type: "DISCONNECT", playerId: "p4" });
    g.ok({ type: "DISCONNECT", playerId: "p3" });
    expect(g.state.hostId).toBe("p5"); // after p3, skipping the absent p4
  });

  it("wraps round to the start of the list", () => {
    const g = lobby(5);
    g.ok({ type: "TRANSFER_HOST", playerId: "p1", targetId: "p5" });
    g.ok({ type: "LEAVE", playerId: "p5" });
    expect(g.state.hostId).toBe("p1");
  });

  it("passes to the next player when the host leaves the lobby", () => {
    const g = lobby(5);
    g.ok({ type: "TRANSFER_HOST", playerId: "p1", targetId: "p2" });
    g.ok({ type: "LEAVE", playerId: "p2" });
    expect(g.state.hostId).toBe("p3");
  });

  it("never passes to a spectator or a kicked player", () => {
    const g = gameWithRoles(R7);
    spectate(g);
    g.ok({ type: "KICK", playerId: "p1", targetId: "p2" });
    g.ok({ type: "DISCONNECT", playerId: "p1" });
    expect(g.state.hostId).toBe("p3");
    expect(g.fail({ type: "TRANSFER_HOST", playerId: "p3", targetId: "late" })).toBe("INVALID_TARGET");
  });
});

describe("profiles", () => {
  it("can be changed in the lobby", () => {
    const g = lobby(5);
    g.ok({ type: "UPDATE_PROFILE", playerId: "p2", name: "Bea", avatar: { color: "red", seed: "dragon" } });
    expect(g.player("p2")).toMatchObject({ name: "Bea", avatar: { color: "red", seed: "dragon" } });
    g.ok({ type: "UPDATE_PROFILE", playerId: "p2", name: "bea" }); // same name, different case: fine for yourself
    expect(g.fail({ type: "UPDATE_PROFILE", playerId: "p3", name: "BEA" })).toBe("NAME_TAKEN");
    expect(g.fail({ type: "UPDATE_PROFILE", playerId: "p3", name: "x".repeat(17) })).toBe("INVALID_NAME");
    expect(
      g.fail({ type: "UPDATE_PROFILE", playerId: "p3", avatar: { color: "red", seed: "NOPE!" } as unknown as typeof AVATAR }),
    ).toBe("INVALID_AVATAR");
  });

  it("are fixed once the game starts", () => {
    const g = gameWithRoles(R7);
    expect(g.fail({ type: "UPDATE_PROFILE", playerId: "p2", name: "Sneaky" })).toBe("WRONG_PHASE");
  });
});
