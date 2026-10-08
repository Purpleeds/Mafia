import { describe, expect, it } from "vitest";
import { isSlow, pulseKind, pulseValues } from "./engine";

describe("pulses", () => {
  it("matches each moment to its effect", () => {
    expect(pulseKind({ kind: "eliminate", mode: "normal" })).toBe("red");
    expect(pulseKind({ kind: "eliminate", mode: "safe" })).toBe("puff");
    expect(pulseKind({ kind: "save" })).toBe("save");
  });

  it("rises, holds and fades away", () => {
    const start = pulseValues("red", 0);
    const peak = pulseValues("red", 0.3);
    const late = pulseValues("red", 2.0);
    expect(start?.pulse[3]).toBe(0);
    expect(peak?.pulse[3]).toBeCloseTo(0.9);
    expect(late?.pulse[3] ?? 0).toBeLessThan(0.1);
    expect(pulseValues("red", 10)).toBeNull();
    expect(pulseValues("red", -1)).toBeNull();
  });

  it("flushes red from the edges for an elimination and glows green from the centre for a save", () => {
    const red = pulseValues("red", 0.3);
    const save = pulseValues("save", 0.8);
    expect(red?.ring[2]).toBe(0);
    expect(save?.ring[2]).toBe(1);
    expect(save?.pulse[1]).toBe(1); // green
    expect(red?.pulse[0]).toBeGreaterThan(red?.pulse[1] ?? 1);
  });

  it("sends its ring outward", () => {
    const early = pulseValues("save", 0.2);
    const later = pulseValues("save", 1.2);
    expect(later?.ring[0] ?? 0).toBeGreaterThan(early?.ring[0] ?? 0);
  });
});

describe("isSlow", () => {
  const repeat = (values: number[], times: number) => Array.from({ length: times }, () => values).flat();

  it("is happy at 60 fps and at 120 fps", () => {
    expect(isSlow(repeat([16.7], 90))).toBe(false);
    expect(isSlow(repeat([8.3], 90))).toBe(false);
  });

  it("accepts a phone capping frames at 30 fps in Low Power Mode", () => {
    expect(isSlow(repeat([33.3], 90))).toBe(false);
  });

  it("notices frames that can't keep up", () => {
    expect(isSlow(repeat([16.7, 33.3, 33.3], 30))).toBe(true);
    expect(isSlow(repeat([50], 90))).toBe(true);
    expect(isSlow(repeat([33.3, 66.7], 45))).toBe(true);
  });

  it("waits for enough frames before judging", () => {
    expect(isSlow([80, 80, 80])).toBe(false);
  });
});
