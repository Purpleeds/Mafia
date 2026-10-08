import { describe, expect, it } from "vitest";
import { BROWS, EXTRAS, EYES, HAIRS, HATS, HEADS, MOUTHS, describeAvatar, traitsFor } from "./avatar";
import { hashString, mulberry32, randomSeed } from "./rng";

const seeds = Array.from({ length: 400 }, (_, i) => `seed${i}`);

describe("random helpers", () => {
  it("are deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it("make valid avatar seeds", () => {
    for (let i = 0; i < 20; i++) expect(randomSeed()).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("traitsFor", () => {
  it("gives the same character for the same seed", () => {
    expect(traitsFor("pickle")).toEqual(traitsFor("pickle"));
  });

  it("only uses known features", () => {
    for (const seed of seeds) {
      const t = traitsFor(seed);
      expect(HEADS).toContain(t.head);
      expect(EYES).toContain(t.eyes);
      expect(BROWS).toContain(t.brows);
      expect(MOUTHS).toContain(t.mouth);
      expect(HAIRS).toContain(t.hair);
      expect(HATS).toContain(t.hat);
      expect(EXTRAS).toContain(t.extra);
    }
  });

  it("makes a varied town", () => {
    const looks = new Set(seeds.map((seed) => JSON.stringify(traitsFor(seed))));
    expect(looks.size).toBeGreaterThan(390);
    const bareHeaded = seeds.filter((seed) => traitsFor(seed).hat === "none").length / seeds.length;
    expect(bareHeaded).toBeGreaterThan(0.15);
    expect(bareHeaded).toBeLessThan(0.35);
    const hats = new Set(seeds.map((seed) => traitsFor(seed).hat));
    expect(hats.size).toBe(HATS.length);
  });

  it("describes the character for screen readers", () => {
    expect(describeAvatar({ color: "teal", seed: "pickle" })).toMatch(/^teal character with /);
  });
});
