import { describe, expect, it } from "vitest";
import { TICK_SECONDS, URGENT_SECONDS, tickFor } from "./tick";

describe("tickFor", () => {
  it("is silent until the last ten seconds", () => {
    expect(TICK_SECONDS).toBe(10);
    for (const seconds of [600, 120, 60, 30, 11]) expect(tickFor(seconds), `${seconds}s`).toBeNull();
  });

  it("ticks once a second for the last ten, firmer for the last three", () => {
    expect(URGENT_SECONDS).toBe(3);
    const sounds = Array.from({ length: 10 }, (_, i) => tickFor(10 - i));
    expect(sounds).toEqual(["tick", "tick", "tick", "tick", "tick", "tick", "tick", "tickUrgent", "tickUrgent", "tickUrgent"]);
  });

  it("is silent when time is up, and for anything that isn't a time", () => {
    for (const seconds of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(tickFor(seconds), String(seconds)).toBeNull();
    }
  });
});
