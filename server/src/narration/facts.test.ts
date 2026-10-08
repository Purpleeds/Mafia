import { ROLES, SKIP, type NarrationFacts, type SettingsPatch } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { Game, R7, gameWithRoles, lobby, runNight, runVote } from "../game/testing/harness.js";
import { availableNightAction } from "../game/night.js";
import { validVoteTargets } from "../game/voting.js";
import type { GameState } from "../game/types.js";
import { narrationFacts } from "./facts.js";

const factsOf = (g: Game): NarrationFacts => {
  const facts = narrationFacts(g.state);
  if (!facts) throw new Error("no narration waiting");
  return facts;
};

const TOP_LEVEL_KEYS = ["eliminated", "gang", "kind", "mode", "round", "saved", "voteOutcome"];

/** Everything the host's browser is sent, with the gang's (public) name taken out. */
function withoutGang(facts: NarrationFacts): string {
  return JSON.stringify({ ...facts, gang: undefined }).toLowerCase();
}

/** Asserts nothing in `facts` could reveal who anyone is: only names of people who left, no ids, no role words. */
function expectOnlyPublicFacts(state: GameState, facts: NarrationFacts, label: string): void {
  expect(Object.keys(facts).sort(), label).toEqual(TOP_LEVEL_KEYS);
  const json = JSON.stringify(facts);
  const leftNames = new Set(facts.eliminated.map((e) => e.name));

  for (const entry of facts.eliminated) {
    expect(Object.keys(entry).sort(), label).toEqual(["how", "name"]);
    const player = state.players.find((p) => p.name === entry.name);
    expect(player?.alive, `${label}: ${entry.name} is still alive`).toBe(false);
  }
  // No ids, no player the narrator has no business knowing about.
  for (const player of state.players) {
    expect(json, label).not.toContain(`"${player.id}"`);
    if (!leftNames.has(player.name)) expect(json, `${label}: ${player.name}`).not.toMatch(new RegExp(`\\b${player.name}\\b`));
  }
  expect(json, label).not.toMatch(/\bp\d+\b/);
  // No role words anywhere (the gang's own name is public and is the only place "Mafia" appears).
  const plain = withoutGang(facts);
  for (const role of ROLES) expect(plain, `${label}: ${role}`).not.toContain(role);
  for (const word of ["role", "team", "teammate", "protect", "guard", "investigat", "lover", "link", "ballot", "voter"]) {
    expect(plain, `${label}: ${word}`).not.toContain(word);
  }
}

describe("narration facts", () => {
  it("lists who was lost in the night, by name only", () => {
    const g = gameWithRoles(R7); // p1 mafia, p2 doctor, p3 detective, p4–p7 villagers
    runNight(g, [["p1", "p4"]]);
    expect(g.phase).toBe("NIGHT_RESULTS");
    expect(factsOf(g)).toEqual({
      kind: "night",
      mode: "safe",
      round: 1,
      gang: "Mafia",
      eliminated: [{ name: "Player 4", how: "night" }],
      saved: false,
      voteOutcome: null,
    });
    expectOnlyPublicFacts(g.state, factsOf(g), "night kill");
  });

  it("says when the Doctor saved someone, but never who", () => {
    const g = gameWithRoles(R7);
    runNight(g, [
      ["p1", "p4"],
      ["p2", "p4"],
    ]);
    const facts = factsOf(g);
    expect(facts).toMatchObject({ eliminated: [], saved: true });
    expect(JSON.stringify(facts)).not.toContain("Player 4");
    expectOnlyPublicFacts(g.state, facts, "save");
  });

  it("looks exactly like a quiet night when saves are not announced", () => {
    const quiet = gameWithRoles(R7, { settings: { announceSaves: false } });
    runNight(quiet, [
      ["p1", "p4"],
      ["p2", "p4"],
    ]);
    const empty = gameWithRoles(R7, { settings: { announceSaves: false } });
    runNight(empty, []);
    expect(factsOf(quiet)).toEqual(factsOf(empty));
    expect(factsOf(quiet).saved).toBe(false);
  });

  it("doesn't reveal the Bodyguard: the Bodyguard just seems to have been lost", () => {
    const g = gameWithRoles(["mafia", "doctor", "detective", "bodyguard", "villager", "villager", "villager", "villager"]);
    runNight(g, [
      ["p1", "p5"],
      ["p4", "p5"],
    ]);
    const facts = factsOf(g);
    expect(facts.eliminated).toEqual([{ name: "Player 4", how: "night" }]);
    expectOnlyPublicFacts(g.state, facts, "bodyguard");
  });

  it("includes a broken-heart loss as a second name, without saying who the lovers are beyond that", () => {
    const g = gameWithRoles(["mafia", "doctor", "cupid", "villager", "villager", "villager", "villager", "villager"]);
    g.nightAct("p3", "p4", "p5"); // Cupid links p4 and p5
    g.nightAct("p1", "p4");
    if (g.phase === "NIGHT") g.endPhase();
    const facts = factsOf(g);
    expect(facts.eliminated).toEqual([
      { name: "Player 4", how: "night" },
      { name: "Player 5", how: "heartbreak" },
    ]);
    expectOnlyPublicFacts(g.state, facts, "heartbreak");
  });

  it("reports the vote: who went, or that nobody did", () => {
    const out = gameWithRoles(R7);
    runNight(out, []);
    out.advanceTo("VOTING");
    runVote(out, { p1: "p4", p2: "p4", p3: "p4", p5: "p4" });
    expect(out.phase).toBe("VOTE_RESULTS");
    expect(factsOf(out)).toMatchObject({
      kind: "vote",
      eliminated: [{ name: "Player 4", how: "vote" }],
      voteOutcome: "eliminated",
      saved: false,
    });

    const skip = gameWithRoles(R7);
    runNight(skip, []);
    skip.advanceTo("VOTING");
    runVote(skip, { p1: SKIP, p2: SKIP, p3: SKIP, p4: SKIP, p5: SKIP, p6: SKIP, p7: SKIP });
    expect(factsOf(skip)).toMatchObject({ kind: "vote", eliminated: [], voteOutcome: "skipped" });

    const tie = gameWithRoles(R7);
    runNight(tie, []);
    tie.advanceTo("VOTING");
    runVote(tie, { p1: "p4", p2: "p4", p3: "p4", p4: "p5", p6: "p5", p7: "p5" });
    expect(factsOf(tie)).toMatchObject({ eliminated: [], voteOutcome: "tie" });

    const nobody = gameWithRoles(R7);
    runNight(nobody, []);
    nobody.advanceTo("VOTING");
    for (const p of nobody.state.players) p.connected = false;
    nobody.endPhase();
    expect(factsOf(nobody)).toMatchObject({ eliminated: [], voteOutcome: "nobody" });
  });

  it("says what the Mafia are called in this game", () => {
    const safe = gameWithRoles(R7, { settings: { sneakyGang: true } });
    runNight(safe, []);
    expect(factsOf(safe).gang).toBe("Sneaky Gang");
    // The rename is a Safe Mode option only.
    const normal = gameWithRoles(R7, { settings: { contentMode: "normal", sneakyGang: true } });
    runNight(normal, []);
    expect(factsOf(normal)).toMatchObject({ gang: "Mafia", mode: "normal" });
  });

  it("is null when nothing is waiting to be narrated", () => {
    expect(narrationFacts(lobby(5).state)).toBeNull();
    const g = gameWithRoles(R7);
    expect(narrationFacts(g.state)).toBeNull(); // first night, nothing announced yet
  });
});

/** Plays one game with random choices and checks the facts after every announcement. */
function playRandomGame(seed: number, players: number, settings: SettingsPatch): number {
  const g = lobby(players, seed);
  g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings });
  g.ok({ type: "START_GAME", playerId: "p1" });
  let checked = 0;
  let step = 0;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(g.rng() * items.length)] as T;

  while (g.phase !== "GAME_OVER" && step++ < 60) {
    switch (g.phase) {
      case "NIGHT": {
        for (const player of g.state.players) {
          const action = availableNightAction(g.state, player);
          if (!action || g.phase !== "NIGHT" || g.rng() < 0.15) continue;
          if (action.kind === "link") {
            const first = pick(action.validTargetIds);
            const second = pick(action.validTargetIds.filter((id) => id !== first));
            g.nightAct(player.id, first, second);
          } else {
            g.nightAct(player.id, pick(action.validTargetIds));
          }
        }
        if (g.phase === "NIGHT") g.endPhase();
        break;
      }
      case "VOTING": {
        for (const player of g.state.players) {
          if (g.phase !== "VOTING") break;
          const targets = validVoteTargets(g.state, player);
          if (targets.length > 0 && g.rng() < 0.9) g.vote(player.id, pick(targets));
        }
        if (g.phase === "VOTING") g.endPhase();
        break;
      }
      case "NIGHT_RESULTS":
      case "VOTE_RESULTS": {
        const facts = narrationFacts(g.state);
        expect(facts, `seed ${seed}`).not.toBeNull();
        if (facts) {
          expectOnlyPublicFacts(g.state, facts, `seed ${seed} ${g.phase}`);
          checked++;
        }
        g.endPhase();
        break;
      }
      default:
        g.endPhase();
    }
  }
  return checked;
}

describe("the facts never contain hidden role information", () => {
  it("holds in hundreds of random games, with every role and setting", () => {
    const all = { jester: true, bodyguard: true, cupid: true };
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const players of [5, 6, 8, 12]) {
        checked += playRandomGame(seed, players, {
          // five players have no room for the extra roles
          optionalRoles: players >= 6 ? all : { jester: false, bodyguard: false, cupid: false },
          announceSaves: seed % 2 === 0,
          tieRule: seed % 3 === 0 ? "revote" : "no_elimination",
          revealRoleOnDeath: seed % 4 !== 0,
          showVotes: seed % 5 !== 0,
          contentMode: seed % 2 === 0 ? "normal" : "safe",
          sneakyGang: seed % 3 === 0,
        });
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
