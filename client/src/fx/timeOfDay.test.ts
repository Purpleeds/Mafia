import { describe, expect, it } from "vitest";
import type { Phase } from "@mafia/shared";
import { sceneColors } from "./palette";
import { dayForScene, dayTransitionMs, nextDayValue } from "./timeOfDay";

const scene = (phase: Phase | null, mode: "safe" | "normal" = "safe", winner: "town" | "mafia" | "jester" | null = null) => ({
  mode,
  phase,
  winner,
});

describe("dayForScene", () => {
  it("follows the game: night is dark, the day is bright, the vote ends at sunset", () => {
    expect(dayForScene(scene("NIGHT"))).toBe(0);
    expect(sceneColors(dayForScene(scene("NIGHT")), 0).stars).toBeGreaterThan(0.7);
    expect(sceneColors(dayForScene(scene("DAY_DISCUSSION")), 0).dayAmount).toBeGreaterThan(0.9);
    expect(sceneColors(dayForScene(scene("VOTING")), 0).dayAmount).toBeGreaterThan(0.5);
    expect(dayForScene(scene("VOTE_RESULTS"))).toBeCloseTo(0.745);
    expect(dayForScene(scene("NIGHT_RESULTS"))).toBeGreaterThan(0.25);
    expect(dayForScene(scene("NIGHT_RESULTS"))).toBeLessThan(0.35);
  });

  it("ends the game in daylight for the town and at night for the Mafia", () => {
    expect(sceneColors(dayForScene(scene("GAME_OVER", "safe", "town")), 0).dayAmount).toBeGreaterThan(0.8);
    expect(sceneColors(dayForScene(scene("GAME_OVER", "safe", "mafia")), 0).stars).toBeGreaterThan(0.7);
  });

  it("gives Normal Mode's lobby a dusky sky", () => {
    expect(sceneColors(dayForScene(scene("LOBBY", "normal")), 1).dayAmount).toBeLessThan(0.1);
    expect(sceneColors(dayForScene(scene("LOBBY", "safe")), 0).dayAmount).toBeGreaterThan(0.6);
  });
});

describe("nextDayValue", () => {
  it("moves time forward, through midnight when needed", () => {
    expect(nextDayValue(0.29, 0.45)).toBeCloseTo(0.45);
    expect(nextDayValue(0.745, 0)).toBeCloseTo(1);
    expect(nextDayValue(3.745, 0)).toBeCloseTo(4);
    expect(nextDayValue(0.84, 0)).toBeCloseTo(1);
  });

  it("steps back instead of spinning through a whole day for small reversals", () => {
    expect(nextDayValue(0.77, 0.6)).toBeCloseTo(0.6);
    expect(nextDayValue(5.77, 0.6)).toBeCloseTo(5.6);
  });

  it("never moves more than two thirds of a day", () => {
    for (let a = 0; a < 1; a += 0.05) {
      for (let b = 0; b < 1; b += 0.05) {
        const delta = nextDayValue(a, b) - a;
        expect(delta).toBeGreaterThan(-0.35);
        expect(delta).toBeLessThanOrEqual(0.66 + 1e-9);
      }
    }
  });
});

describe("dayTransitionMs", () => {
  it("takes longer for bigger jumps, within limits", () => {
    expect(dayTransitionMs(0)).toBe(1200);
    expect(dayTransitionMs(0.25)).toBeGreaterThan(dayTransitionMs(0.1));
    expect(dayTransitionMs(-0.25)).toBe(dayTransitionMs(0.25));
    expect(dayTransitionMs(5)).toBe(7200);
  });
});
