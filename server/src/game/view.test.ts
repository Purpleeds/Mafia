import { describe, expect, it } from "vitest";
import type { Role } from "@mafia/shared";
import { getGameView } from "./view.js";
import { R7, R8, gameWithRoles, ids, runNight, runVote, type Game } from "./testing/harness.js";

/** Every `"role":"x"` value that appears anywhere in a serialized view. */
function rolesMentioned(view: unknown): string[] {
  return [...JSON.stringify(view).matchAll(/"role":"(\w+)"/g)].map((m) => m[1] ?? "");
}

function checkNoLeaks(g: Game): void {
  for (const id of ids(g.state.players.length)) {
    const view = getGameView(g.state, id);
    const own = g.player(id).role;
    const publicRoles = view.players.map((p) => p.role).filter((r): r is Role => r !== null);
    // Roles in the view: only the viewer's own, plus ones deliberately made public.
    const allowed = new Set<string>([...(own ? [own] : []), ...publicRoles]);
    for (const mentioned of rolesMentioned(view)) expect(allowed.has(mentioned)).toBe(true);
  }
}

describe("hidden information", () => {
  it("never puts another player's role in a view", () => {
    const g = gameWithRoles(R8, { settings: { revealRoleOnDeath: false } });
    checkNoLeaks(g);
    g.nightAct("p1", "p5");
    g.nightAct("p3", "p5");
    g.nightAct("p4", "p2");
    checkNoLeaks(g);
    g.endPhase();
    checkNoLeaks(g);
    g.advanceTo("VOTING");
    checkNoLeaks(g);
    for (const view of ids(8).map((id) => getGameView(g.state, id))) {
      expect(view.players.every((p) => p.role === null)).toBe(true);
    }
  });

  it("shows teammates and their votes only to the Mafia", () => {
    const g = gameWithRoles(R8);
    g.nightAct("p1", "p6");
    const mafia = getGameView(g.state, "p2");
    expect(mafia.you?.teammateIds).toEqual(["p1"]);
    expect(mafia.you?.nightAction).toMatchObject({ kind: "kill", teammateVotes: { p1: "p6" } });
    for (const other of ["p3", "p4", "p5", "p8"]) {
      const view = getGameView(g.state, other);
      expect(view.you?.teammateIds).toEqual([]);
      expect(JSON.stringify(view)).not.toContain("teammateVotes\":{");
    }
    // a villager's view carries no night votes at all
    expect(getGameView(g.state, "p5").you?.nightAction).toBeNull();
  });

  it("gives night options only to the roles that have them", () => {
    const g = gameWithRoles(R7);
    const kinds = ids(7).map((id) => getGameView(g.state, id).you?.nightAction?.kind ?? null);
    expect(kinds).toEqual(["kill", "protect", "investigate", null, null, null, null]);
    expect(getGameView(g.state, "p1").you?.nightAction?.validTargetIds).not.toContain("p1");
  });

  it("exposes a death's role only if the host chose to reveal roles", () => {
    const shown = gameWithRoles(R7, { settings: { revealRoleOnDeath: true } });
    runNight(shown, [["p1", "p3"]]);
    expect(getGameView(shown.state, "p5").nightReport?.deaths).toEqual([
      { playerId: "p3", cause: "mafia", role: "detective" },
    ]);
    expect(getGameView(shown.state, "p5").players[2]?.role).toBe("detective");

    const hidden = gameWithRoles(R7, { settings: { revealRoleOnDeath: false } });
    runNight(hidden, [["p1", "p3"]]);
    expect(getGameView(hidden.state, "p5").nightReport?.deaths).toEqual([
      { playerId: "p3", cause: "mafia", role: null },
    ]);
    expect(getGameView(hidden.state, "p5").players[2]?.role).toBeNull();
    // the dead player still knows their own
    expect(getGameView(hidden.state, "p3").you?.role).toBe("detective");
  });

  it("reveals the vote result's role only when roles are public", () => {
    const g = gameWithRoles(R7, { settings: { revealRoleOnDeath: false } });
    g.advanceTo("VOTING");
    runVote(g, { p1: "p4", p2: "p4", p3: "p4", p5: "p4", p6: "p4" });
    expect(getGameView(g.state, "p6").voteReport?.deaths).toEqual([{ playerId: "p4", cause: "vote", role: null }]);
  });

  it("reveals everything at game over", () => {
    const g = gameWithRoles(R7);
    g.advanceTo("VOTING");
    runVote(g, { p2: "p1", p3: "p1", p4: "p1", p5: "p1", p6: "p1", p7: "p1" });
    g.endPhase();
    const roles = getGameView(g.state, "p6").players.map((p) => p.role);
    expect(roles).toEqual(R7);
  });

  it("reports unknown viewers as having no player", () => {
    const g = gameWithRoles(R7);
    const view = getGameView(g.state, "stranger");
    expect(view.you).toBeNull();
    expect(view.players.every((p) => p.role === null)).toBe(true);
  });

  it("gives the same shared facts to everyone", () => {
    const g = gameWithRoles(R7);
    const a = getGameView(g.state, "p1");
    const b = getGameView(g.state, "p6");
    expect({ ...a, you: null, voting: null }).toEqual({ ...b, you: null, voting: null });
  });
});
