import { OPTIONAL_ROLES, defaultMafiaCount, maxMafiaCount, type Role } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { buildRoleList, dealRoles } from "./roles.js";
import { mulberry32 } from "./rng.js";
import { ids, lobby } from "./testing/harness.js";

const none = { jester: false, bodyguard: false, cupid: false };
const all = { jester: true, bodyguard: true, cupid: true };

function count(roles: readonly (Role | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of roles) if (r) out[r] = (out[r] ?? 0) + 1;
  return out;
}

describe("Mafia count", () => {
  it("defaults to roughly one per four players, at least one", () => {
    const expected: Record<number, number> = { 5: 1, 7: 1, 8: 2, 11: 2, 12: 3, 15: 3, 16: 4, 20: 5 };
    for (const [n, mafia] of Object.entries(expected)) expect(defaultMafiaCount(Number(n))).toBe(mafia);
  });

  it("is capped at a third of the players", () => {
    expect(maxMafiaCount(5)).toBe(1);
    expect(maxMafiaCount(6)).toBe(2);
    expect(maxMafiaCount(9)).toBe(3);
    expect(maxMafiaCount(20)).toBe(6);
  });
});

describe("role list", () => {
  it("is Mafia, Doctor, Detective and Villagers for the rest", () => {
    expect(count(buildRoleList(8, 2, none) ?? [])).toEqual({ mafia: 2, doctor: 1, detective: 1, villager: 4 });
  });

  it("adds each switched-on optional role exactly once", () => {
    const roles = buildRoleList(10, 2, all) ?? [];
    expect(count(roles)).toEqual({
      mafia: 2,
      doctor: 1,
      detective: 1,
      jester: 1,
      bodyguard: 1,
      cupid: 1,
      villager: 3,
    });
    for (const role of OPTIONAL_ROLES) {
      const one = buildRoleList(10, 2, { ...none, [role]: true }) ?? [];
      expect(count(one)[role]).toBe(1);
    }
  });

  it("returns null when the special roles don't fit", () => {
    expect(buildRoleList(5, 1, all)).toBeNull(); // 1 + 2 + 3 = 6 > 5
    expect(buildRoleList(5, 1, { ...all, cupid: false })).not.toBeNull(); // exactly 5, no villagers
  });
});

describe("dealing", () => {
  const players = ids(9);
  const roles = buildRoleList(9, 2, all) ?? [];

  it("gives every player exactly one role from the list", () => {
    const dealt = dealRoles(players, roles, mulberry32(7));
    expect(Object.keys(dealt).sort()).toEqual([...players].sort());
    expect(count(Object.values(dealt))).toEqual(count(roles));
  });

  it("is repeatable for a seed and different across seeds", () => {
    const a = dealRoles(players, roles, mulberry32(1));
    expect(dealRoles(players, roles, mulberry32(1))).toEqual(a);
    const distinct = new Set(
      Array.from({ length: 20 }, (_, s) => JSON.stringify(dealRoles(players, roles, mulberry32(s)))),
    );
    expect(distinct.size).toBeGreaterThan(15);
  });

  it("can make any seat the Mafia", () => {
    const mafiaSeats = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const dealt = dealRoles(ids(5), buildRoleList(5, 1, none) ?? [], mulberry32(seed));
      for (const [id, role] of Object.entries(dealt)) if (role === "mafia") mafiaSeats.add(id);
    }
    expect(mafiaSeats.size).toBe(5);
  });
});

describe("START_GAME role assignment", () => {
  it.each([5, 8, 12, 16, 20])("deals a legal setup for %i players", (n) => {
    const g = lobby(n);
    g.ok({ type: "START_GAME", playerId: "p1" });
    const dealt = count(g.state.players.map((p) => p.role));
    expect(dealt.mafia).toBe(defaultMafiaCount(n));
    expect(dealt.doctor).toBe(1);
    expect(dealt.detective).toBe(1);
    expect(g.state.players.every((p) => p.role !== null && p.alive)).toBe(true);
    expect(g.state.mafiaCount).toBe(defaultMafiaCount(n));
  });

  it("honours the host's Mafia count and optional roles", () => {
    const g = lobby(12);
    g.ok({
      type: "UPDATE_SETTINGS",
      playerId: "p1",
      settings: { mafiaCount: 3, optionalRoles: { jester: true, cupid: true } },
    });
    g.ok({ type: "START_GAME", playerId: "p1" });
    const dealt = count(g.state.players.map((p) => p.role));
    expect(dealt).toMatchObject({ mafia: 3, doctor: 1, detective: 1, jester: 1, cupid: 1, villager: 5 });
    expect(dealt.bodyguard).toBeUndefined();
  });

  it("refuses more Mafia than a third of the players", () => {
    const g = lobby(6);
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { mafiaCount: 3 } });
    expect(g.fail({ type: "START_GAME", playerId: "p1" })).toBe("INVALID_SETTINGS");
  });

  it("refuses when the special roles don't fit", () => {
    const g = lobby(5);
    g.ok({
      type: "UPDATE_SETTINGS",
      playerId: "p1",
      settings: { optionalRoles: { jester: true, bodyguard: true, cupid: true } },
    });
    expect(g.fail({ type: "START_GAME", playerId: "p1" })).toBe("TOO_MANY_ROLES");
  });
});
