import { describe, expect, it } from "vitest";
import { HORIZON } from "./palette";
import {
  LAYER_NAMES,
  LIGHT_LEVELS,
  VILLAGE_HEIGHT,
  VILLAGE_WIDTH,
  buildVillage,
  createVillage,
  farHeight,
  midHeight,
  nearHeight,
  windmillSailsPath,
} from "./village";

const village = buildVillage();
const PATH = /^[MLHVAZmlhvaz0-9 .\-]+$/;

describe("village art", () => {
  it("is the same every time it is drawn", () => {
    expect(createVillage()).toEqual(createVillage());
    expect(buildVillage()).toBe(village);
  });

  it("has three layers of plain SVG path data", () => {
    for (const name of LAYER_NAMES) {
      const layer = village.layers[name];
      expect(layer.path.length).toBeGreaterThan(500);
      expect(layer.path).toMatch(PATH);
      for (const group of layer.lights) expect(group.path).toMatch(PATH);
    }
  });

  it("lights windows in every layer, at the known brightness levels", () => {
    for (const name of LAYER_NAMES) {
      const groups = village.layers[name].lights;
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) expect(LIGHT_LEVELS).toContain(group.level);
    }
    // The church clock is the one face cut with the even-odd rule (its hands are holes).
    expect(village.layers.mid.lights.filter((g) => g.evenOdd)).toHaveLength(1);
  });

  it("keeps every object inside the art, so nothing is cut off", () => {
    for (const name of LAYER_NAMES) {
      for (const o of village.layers[name].objects) {
        expect(o.x, `${name} ${o.kind}`).toBeGreaterThanOrEqual(0);
        expect(o.x + o.w, `${name} ${o.kind}`).toBeLessThanOrEqual(VILLAGE_WIDTH);
        expect(o.y, `${name} ${o.kind}`).toBeGreaterThanOrEqual(0);
        expect(o.y + o.h, `${name} ${o.kind}`).toBeLessThanOrEqual(VILLAGE_HEIGHT + 10);
      }
    }
    const mill = village.windmill;
    expect(mill.y - mill.radius).toBeGreaterThan(0);
  });

  it("puts the church in the middle of the screen", () => {
    const church = village.layers.mid.objects.find((o) => o.kind === "church");
    expect(church).toBeDefined();
    if (church) expect(church.x + church.w / 2).toBeCloseTo(VILLAGE_WIDTH / 2);
  });

  it("tiles seamlessly: the ground lines meet at the edges", () => {
    for (const height of [farHeight, midHeight, nearHeight]) {
      expect(height(0)).toBeCloseTo(height(VILLAGE_WIDTH), 6);
      expect(height(-37)).toBeCloseTo(height(VILLAGE_WIDTH - 37), 6);
    }
  });

  it("stacks the layers: far hills above the village, the village above the meadow", () => {
    for (let x = 0; x < VILLAGE_WIDTH; x += 16) {
      expect(farHeight(x)).toBeGreaterThan(midHeight(x) + 20);
      expect(midHeight(x)).toBeGreaterThan(nearHeight(x));
    }
  });

  it("hides the rising and setting sun behind the hills on any screen shape", () => {
    // Scene widths from a narrow phone to an ultrawide monitor (see sunAndMoon).
    for (let width = 0.6; width <= 2.4; width += 0.1) {
      const offset = 0.38 * width * 1024;
      for (const x of [VILLAGE_WIDTH / 2 - offset, VILLAGE_WIDTH / 2 + offset]) {
        expect(farHeight(x), `width ${width.toFixed(1)}`).toBeGreaterThan(HORIZON * 1024);
      }
    }
  });

  it("draws static windmill sails for the fallback", () => {
    expect(windmillSailsPath(village.windmill, 0.3)).toMatch(PATH);
  });
});
