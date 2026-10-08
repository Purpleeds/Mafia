import { ROLES } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { closestPair, deltaE2000, simulate, type Vision } from "./colorVision";
import { ROLE_THEME } from "./roles";

const mains = Object.fromEntries(ROLES.map((r) => [r, ROLE_THEME[r].main]));

describe("role colours for colour-blind players", () => {
  it("knows that two very different colours are far apart, and one colour is zero from itself", () => {
    expect(deltaE2000(simulate("#ff0000", "normal"), simulate("#0000ff", "normal"))).toBeGreaterThan(40);
    expect(deltaE2000(simulate("#56b4e9", "normal"), simulate("#56b4e9", "normal"))).toBeCloseTo(0, 6);
  });

  it("knows red and green look alike to red-green colour-blind eyes (the old palette's problem)", () => {
    const red = simulate("#c2334a", "deutan");
    const green = simulate("#56a23a", "deutan");
    expect(deltaE2000(red, green)).toBeLessThan(deltaE2000(simulate("#c2334a", "normal"), simulate("#56a23a", "normal")) / 3);
  });

  it.each<Vision>(["normal", "protan", "deutan", "tritan"])("keeps every pair of roles clearly different (%s vision)", (vision) => {
    const { a, b, deltaE } = closestPair(mains, vision);
    expect(deltaE, `${a} vs ${b}`).toBeGreaterThanOrEqual(10);
  });

  it("gives every role its own colour", () => {
    expect(new Set(Object.values(mains)).size).toBe(ROLES.length);
  });
});
