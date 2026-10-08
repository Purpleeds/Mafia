import { describe, expect, it } from "vitest";
import { HORIZON, hexToRgb, rgbToCss, sceneColors, sceneUnit, smoothstep, sunAndMoon, type RGB } from "./palette";

const luminance = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const maxDiff = (a: RGB, b: RGB) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

describe("colour helpers", () => {
  it("converts hex to 0..1 channels and back", () => {
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(rgbToCss([1, 0.5, 0])).toBe("rgb(255, 128, 0)");
    expect(rgbToCss([2, -1, 0.25])).toBe("rgb(255, 0, 64)");
  });

  it("smoothstep eases between its edges", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });
});

describe("sceneColors", () => {
  it("is bright at noon and dark at midnight, with stars and window lights only at night", () => {
    for (const mode of [0, 1]) {
      const noon = sceneColors(0.5, mode);
      const midnight = sceneColors(0, mode);
      expect(luminance(noon.zenith)).toBeGreaterThan(luminance(midnight.zenith) + 0.2);
      expect(noon.stars).toBe(0);
      expect(noon.lights).toBe(0);
      expect(midnight.stars).toBeGreaterThan(0.7);
      expect(midnight.lights).toBeGreaterThan(0.85);
      expect(noon.dayAmount).toBeGreaterThan(0.95);
      expect(midnight.dayAmount).toBe(0);
    }
  });

  it("makes Normal Mode darker and grainier than Safe Mode", () => {
    for (const day of [0, 0.3, 0.5, 0.75]) {
      const safe = sceneColors(day, 0);
      const normal = sceneColors(day, 1);
      expect(luminance(normal.zenith)).toBeLessThan(luminance(safe.zenith));
      expect(normal.grain).toBeGreaterThan(safe.grain);
      expect(normal.vignette).toBeGreaterThan(safe.vignette);
    }
  });

  it("wraps around the clock", () => {
    for (const [a, b] of [
      [1, 0],
      [-0.25, 0.75],
      [2.4, 0.4],
    ] as const) {
      const x = sceneColors(a, 1);
      const y = sceneColors(b, 1);
      expect(maxDiff(x.zenith, y.zenith)).toBeLessThan(1e-9);
      expect(maxDiff(x.far, y.far)).toBeLessThan(1e-9);
      expect(x.dayAmount).toBeCloseTo(y.dayAmount, 9);
      expect(x.lights).toBeCloseTo(y.lights, 9);
    }
  });

  it("changes smoothly through the whole day (no jumps between keyframes)", () => {
    for (const mode of [0, 0.5, 1]) {
      let previous = sceneColors(0, mode);
      for (let i = 1; i <= 1000; i++) {
        const next = sceneColors(i / 1000, mode);
        expect(maxDiff(previous.zenith, next.zenith)).toBeLessThan(0.05);
        expect(maxDiff(previous.near, next.near)).toBeLessThan(0.05);
        expect(Math.abs(previous.lights - next.lights)).toBeLessThan(0.05);
        previous = next;
      }
    }
  });
});

describe("scene space", () => {
  it("uses the screen height, but no more than 1.3 × the width", () => {
    expect(sceneUnit(1440, 900)).toBe(900);
    expect(sceneUnit(390, 844)).toBeCloseTo(507);
    expect(sceneUnit(0, 0)).toBe(1);
  });

  it("puts the sun at the top at noon and the moon at the top at midnight", () => {
    const view = { width: 1.6, height: 1 };
    const noon = sunAndMoon(0.5, view);
    expect(noon.sun.x).toBeCloseTo(0);
    expect(noon.sun.y).toBeCloseTo(0.8);
    expect(noon.sun.w).toBe(1);
    expect(noon.moon.w).toBe(0);
    const midnight = sunAndMoon(0, view);
    expect(midnight.moon.x).toBeCloseTo(0);
    expect(midnight.moon.w).toBe(1);
    expect(midnight.sun.w).toBe(0);
  });

  it("rises on the left and sets on the right, at the horizon", () => {
    const view = { width: 2, height: 1.2 };
    const sunrise = sunAndMoon(0.25, view).sun;
    const sunset = sunAndMoon(0.75, view).sun;
    expect(sunrise.x).toBeCloseTo(-0.76);
    expect(sunset.x).toBeCloseTo(0.76);
    expect(sunrise.y).toBeCloseTo(HORIZON);
    expect(sunset.y).toBeCloseTo(HORIZON);
  });
});
