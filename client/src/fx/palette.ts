/**
 * Colours of the valley at every time of day, for both content modes. The WebGL
 * background and the static CSS fallback both read these, so they always match.
 *
 * Time of day `day` runs 0..1: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
 */

export type RGB = readonly [number, number, number];

interface Key {
  at: number;
  zenith: string;
  horizon: string;
  far: string;
  mid: string;
  near: string;
  fog: string;
  stars: number;
  lights: number;
  fogAmount: number;
}

// Safe Mode: bright, friendly storybook colours.
const SAFE: Key[] = [
  { at: 0.0, zenith: "#0b1033", horizon: "#26306b", far: "#1d2454", mid: "#131a3c", near: "#0b0f26", fog: "#5866a8", stars: 1, lights: 1, fogAmount: 0.85 },
  { at: 0.21, zenith: "#1c2357", horizon: "#5a4f8c", far: "#2f3165", mid: "#20224a", near: "#151634", fog: "#7f7bb5", stars: 0.6, lights: 0.8, fogAmount: 0.75 },
  { at: 0.28, zenith: "#4d6fc4", horizon: "#ffb08a", far: "#8a7fb8", mid: "#5d5a8f", near: "#3e3c6a", fog: "#f5cbb8", stars: 0, lights: 0.3, fogAmount: 0.55 },
  { at: 0.36, zenith: "#58a8f0", horizon: "#cfeeff", far: "#8cc4c8", mid: "#5fa36c", near: "#3f7f4a", fog: "#ffffff", stars: 0, lights: 0, fogAmount: 0.22 },
  { at: 0.5, zenith: "#4aa6ff", horizon: "#bfe8ff", far: "#92c9d6", mid: "#5cae6a", near: "#3b8a49", fog: "#ffffff", stars: 0, lights: 0, fogAmount: 0.14 },
  { at: 0.65, zenith: "#5a9fe8", horizon: "#ffe2a8", far: "#9cc0b8", mid: "#6aa65f", near: "#46844a", fog: "#fff3d6", stars: 0, lights: 0, fogAmount: 0.2 },
  { at: 0.745, zenith: "#4a4ea8", horizon: "#ff8a5b", far: "#9b6f8f", mid: "#6b4c6e", near: "#47334f", fog: "#ffc2a0", stars: 0.05, lights: 0.35, fogAmount: 0.42 },
  { at: 0.81, zenith: "#232a6b", horizon: "#b0558a", far: "#4a3a6e", mid: "#2e2650", near: "#1d1838", fog: "#9a86c0", stars: 0.5, lights: 0.85, fogAmount: 0.65 },
  { at: 0.9, zenith: "#121845", horizon: "#3a3a80", far: "#24285e", mid: "#171c42", near: "#0e112c", fog: "#6a72b0", stars: 0.9, lights: 1, fogAmount: 0.8 },
];

// Normal Mode: darker, desaturated noir with a blood-orange sunset.
const NORMAL: Key[] = [
  { at: 0.0, zenith: "#05060b", horizon: "#151a26", far: "#11141e", mid: "#0a0d14", near: "#05070c", fog: "#3d4452", stars: 0.75, lights: 0.9, fogAmount: 1 },
  { at: 0.21, zenith: "#0b0e18", horizon: "#262634", far: "#181b26", mid: "#10121b", near: "#090a11", fog: "#4a4b5a", stars: 0.45, lights: 0.8, fogAmount: 0.95 },
  { at: 0.28, zenith: "#2a3042", horizon: "#8c6656", far: "#4c4a52", mid: "#2f2f37", near: "#1d1d24", fog: "#a08a80", stars: 0, lights: 0.4, fogAmount: 0.8 },
  { at: 0.36, zenith: "#5d6c7d", horizon: "#b7bcbf", far: "#7b8789", mid: "#4f5b55", near: "#333d38", fog: "#d9dcdc", stars: 0, lights: 0, fogAmount: 0.55 },
  { at: 0.5, zenith: "#6b7c8e", horizon: "#c3c9cc", far: "#8a979a", mid: "#56645c", near: "#39463e", fog: "#e2e5e6", stars: 0, lights: 0, fogAmount: 0.45 },
  { at: 0.65, zenith: "#5f6b7c", horizon: "#c8b59a", far: "#807f7c", mid: "#545a50", near: "#383d36", fog: "#ddd2c2", stars: 0, lights: 0, fogAmount: 0.5 },
  { at: 0.745, zenith: "#2c2c3e", horizon: "#a3442f", far: "#5b3a38", mid: "#3a2729", near: "#24181b", fog: "#a96a58", stars: 0.05, lights: 0.45, fogAmount: 0.7 },
  { at: 0.81, zenith: "#12131f", horizon: "#4e2230", far: "#24192a", mid: "#160f1b", near: "#0c0810", fog: "#5d4656", stars: 0.4, lights: 0.85, fogAmount: 0.9 },
  { at: 0.9, zenith: "#080910", horizon: "#1d1e2c", far: "#13151f", mid: "#0b0d15", near: "#06070c", fog: "#3e4250", stars: 0.7, lights: 0.9, fogAmount: 1 },
];

// moonShadow: offset of the moon's shadow in radii (1.35 = gibbous, 0.62 = crescent).
const MODE_CONST = {
  safe: { sun: "#fff0a8", moon: "#fff6d8", window: "#ffcf6b", grain: 0.035, vignette: 0.28, fog: 0.85, moonShadow: 1.35, clouds: 0.45 },
  normal: { sun: "#f3eadb", moon: "#dfe6f0", window: "#f2a65a", grain: 0.085, vignette: 0.6, fog: 1.15, moonShadow: 0.62, clouds: 0.75 },
} as const;

export function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToCss(c: RGB): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${to(c[0])}, ${to(c[1])}, ${to(c[2])})`;
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

interface ModeLook {
  zenith: RGB;
  horizon: RGB;
  far: RGB;
  mid: RGB;
  near: RGB;
  fog: RGB;
  stars: number;
  lights: number;
  fogAmount: number;
}

function sample(keys: Key[], day: number): ModeLook {
  const d = ((day % 1) + 1) % 1;
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    if (key && key.at <= d) i = k;
  }
  const a = keys[i] ?? keys[0];
  const b = keys[(i + 1) % keys.length] ?? keys[0];
  if (!a || !b) throw new Error("palette has no keys");
  const span = ((b.at - a.at + 1) % 1) || 1;
  const t = smoothstep(0, 1, (((d - a.at) % 1) + 1) % 1 / span);
  return {
    zenith: mixRgb(hexToRgb(a.zenith), hexToRgb(b.zenith), t),
    horizon: mixRgb(hexToRgb(a.horizon), hexToRgb(b.horizon), t),
    far: mixRgb(hexToRgb(a.far), hexToRgb(b.far), t),
    mid: mixRgb(hexToRgb(a.mid), hexToRgb(b.mid), t),
    near: mixRgb(hexToRgb(a.near), hexToRgb(b.near), t),
    fog: mixRgb(hexToRgb(a.fog), hexToRgb(b.fog), t),
    stars: mix(a.stars, b.stars, t),
    lights: mix(a.lights, b.lights, t),
    fogAmount: mix(a.fogAmount, b.fogAmount, t),
  };
}

export interface SceneColors extends ModeLook {
  sun: RGB;
  moon: RGB;
  window: RGB;
  grain: number;
  vignette: number;
  moonShadow: number;
  /** Cloud cover 0..1. */
  clouds: number;
  /** 0 at night .. 1 in full daylight. */
  dayAmount: number;
}

/** Colours for a time of day, blending Safe (mode 0) and Normal (mode 1). */
export function sceneColors(day: number, mode: number): SceneColors {
  const s = sample(SAFE, day);
  const n = sample(NORMAL, day);
  const m = Math.min(1, Math.max(0, mode));
  const c = (k: "zenith" | "horizon" | "far" | "mid" | "near" | "fog") => mixRgb(s[k], n[k], m);
  const sunElevation = Math.sin((day - 0.25) * Math.PI * 2);
  return {
    zenith: c("zenith"),
    horizon: c("horizon"),
    far: c("far"),
    mid: c("mid"),
    near: c("near"),
    fog: c("fog"),
    stars: mix(s.stars, n.stars, m),
    lights: mix(s.lights, n.lights, m),
    fogAmount: mix(s.fogAmount * MODE_CONST.safe.fog, n.fogAmount * MODE_CONST.normal.fog, m),
    sun: mixRgb(hexToRgb(MODE_CONST.safe.sun), hexToRgb(MODE_CONST.normal.sun), m),
    moon: mixRgb(hexToRgb(MODE_CONST.safe.moon), hexToRgb(MODE_CONST.normal.moon), m),
    window: mixRgb(hexToRgb(MODE_CONST.safe.window), hexToRgb(MODE_CONST.normal.window), m),
    grain: mix(MODE_CONST.safe.grain, MODE_CONST.normal.grain, m),
    vignette: mix(MODE_CONST.safe.vignette, MODE_CONST.normal.vignette, m),
    moonShadow: mix(MODE_CONST.safe.moonShadow, MODE_CONST.normal.moonShadow, m),
    clouds: mix(MODE_CONST.safe.clouds, MODE_CONST.normal.clouds, m),
    dayAmount: smoothstep(-0.05, 0.35, sunElevation),
  };
}

/**
 * The scene unit in pixels. Everything in the backdrop (village, sun, moon) is
 * measured in it: the screen height, but never more than 1.3 × the width, so
 * tall phones show more of the village instead of a giant close-up.
 */
export function sceneUnit(width: number, height: number): number {
  return Math.max(1, Math.min(height, width * 1.3));
}

/** The visible area in scene units. */
export interface View {
  width: number;
  height: number;
}

export interface Celestial {
  /** Position in scene units from the bottom centre of the screen (y up). */
  x: number;
  y: number;
  r: number;
  /** Visibility 0..1 (fades as it sets). */
  w: number;
}

/** Height (scene units) where the sun and moon cross the horizon, behind the hills. */
export const HORIZON = 0.24;

/** The sun rises on the left, peaks at noon and sets on the right; the moon does the same at night. */
export function sunAndMoon(day: number, view: View): { sun: Celestial; moon: Celestial } {
  const peak = Math.max(HORIZON + 0.3, view.height * 0.8);
  const body = (phase: number, r: number): Celestial => {
    const a = phase * Math.PI * 2;
    const e = Math.sin(a);
    return {
      x: -0.38 * view.width * Math.cos(a),
      y: HORIZON + (peak - HORIZON) * e,
      r,
      w: smoothstep(-0.12, 0.06, e),
    };
  };
  return { sun: body(day - 0.25, 0.06), moon: body(day + 0.25, 0.055) };
}
