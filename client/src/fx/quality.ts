/**
 * How much the animated background may cost. A quick probe picks a tier for the
 * device, the player can override it (Auto / Full / Lite / Off), and the engine
 * steps down a tier when frames come in slow.
 */
import { useSyncExternalStore } from "react";
import type { ShaderFeatures } from "./shader";

export type FxPreference = "auto" | "full" | "lite" | "off";
export const FX_PREFERENCES: readonly FxPreference[] = ["auto", "full", "lite", "off"];

/** "static" is the CSS + SVG backdrop with no WebGL. */
export type FxTier = "high" | "medium" | "low" | "static";
export type RenderTier = Exclude<FxTier, "static">;
const TIER_ORDER: readonly FxTier[] = ["high", "medium", "low", "static"];

export interface TierSpec {
  /** Most device pixels per CSS pixel. */
  maxScale: number;
  /** Most pixels drawn per frame. */
  maxPixels: number;
  /** Village texture size: 1 = 2048 × 512, 0.5 = 1024 × 256. */
  textureScale: number;
  shader: ShaderFeatures;
}

export const TIER_SPECS: Record<RenderTier, TierSpec> = {
  high: { maxScale: 2, maxPixels: 2_200_000, textureScale: 1, shader: { octaves: 4, clouds: true, glow: true } },
  medium: { maxScale: 1.5, maxPixels: 1_000_000, textureScale: 1, shader: { octaves: 3, clouds: false, glow: true } },
  low: { maxScale: 1, maxPixels: 450_000, textureScale: 0.5, shader: { octaves: 2, clouds: false, glow: false } },
};

/** Drawing-buffer size for a canvas of `cssWidth` × `cssHeight`. */
export function renderSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  tier: RenderTier,
): { width: number; height: number; scale: number } {
  const spec = TIER_SPECS[tier];
  let scale = Math.min(Math.max(dpr, 0.5), spec.maxScale);
  const pixels = cssWidth * cssHeight * scale * scale;
  if (pixels > spec.maxPixels) scale *= Math.sqrt(spec.maxPixels / pixels);
  return {
    width: Math.max(1, Math.round(cssWidth * scale)),
    height: Math.max(1, Math.round(cssHeight * scale)),
    scale,
  };
}

export function lowerTier(tier: FxTier): FxTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, i + 1)] ?? "static";
}

function minTier(a: FxTier, b: FxTier): FxTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

export interface DeviceInfo {
  webgl: boolean;
  /** Fragment shaders support highp floats. */
  highp: boolean;
  /** The browser said WebGL would be slow (usually software rendering). */
  majorPerformanceCaveat: boolean;
  renderer: string;
  maxTextureSize: number;
  cores: number;
  memoryGb: number | null;
  saveData: boolean;
  mobile: boolean;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const OLD_GPU = /mali-4\d\d|mali-t[6-8]\d\d|adreno[^0-9]*[2-4]\d\d(?!\d)|powervr sgx|videocore|tegra [2-4](?!\d)/i;

/** The tier "Auto" picks for a device. */
export function chooseAutoTier(info: DeviceInfo): { tier: FxTier; reason: string } {
  if (!info.webgl) return { tier: "static", reason: "WebGL isn't available" };
  if (!info.highp) return { tier: "static", reason: "the graphics chip is too basic" };
  if (info.majorPerformanceCaveat || SOFTWARE_GPU.test(info.renderer)) {
    return { tier: "static", reason: "graphics are running without a GPU" };
  }
  if (info.maxTextureSize > 0 && info.maxTextureSize < 2048) {
    return { tier: "static", reason: "the graphics chip is too basic" };
  }
  if (info.saveData) return { tier: "low", reason: "Data Saver is on" };
  if (OLD_GPU.test(info.renderer)) return { tier: "low", reason: "an older graphics chip" };
  if ((info.memoryGb !== null && info.memoryGb <= 2) || (info.cores > 0 && info.cores <= 2)) {
    return { tier: "low", reason: "a low-memory device" };
  }
  if (info.mobile) return { tier: "medium", reason: "a phone or tablet" };
  if (info.memoryGb !== null && info.memoryGb <= 4 && info.cores > 0 && info.cores <= 4) {
    return { tier: "medium", reason: "a modest computer" };
  }
  return { tier: "high", reason: "a capable device" };
}

/** Which tier a preference gives, given what Auto would pick and the device's limits. */
export function tierForPreference(preference: FxPreference, auto: FxTier, canRender: boolean, cap: FxTier): FxTier {
  if (preference === "off" || !canRender) return "static";
  if (preference === "full") return "high";
  if (preference === "lite") return "low";
  return minTier(auto, cap);
}

/** Probes the browser once (creates and throws away a WebGL context). */
export function probeDevice(): DeviceInfo {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
    userAgentData?: { mobile?: boolean };
  };
  const ua = nav.userAgent ?? "";
  const info: DeviceInfo = {
    webgl: false,
    highp: false,
    majorPerformanceCaveat: false,
    renderer: "",
    maxTextureSize: 0,
    cores: nav.hardwareConcurrency || 0,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    saveData: nav.connection?.saveData === true,
    mobile:
      nav.userAgentData?.mobile ??
      (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)),
  };
  try {
    let gl = document.createElement("canvas").getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (!gl) {
      gl = document.createElement("canvas").getContext("webgl");
      if (gl) info.majorPerformanceCaveat = true;
    }
    if (!gl) return info;
    info.webgl = true;
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    info.highp = (precision?.precision ?? 0) > 0;
    info.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    info.renderer = typeof renderer === "string" ? renderer : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // No WebGL: the static backdrop it is.
  }
  return info;
}

// ------------------------------------------------------------------ state

const PREFERENCE_KEY = "mafia.fx";
const CAP_KEY = "mafia.fx.cap";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

const isPreference = (v: unknown): v is FxPreference => FX_PREFERENCES.includes(v as FxPreference);
const isTier = (v: unknown): v is FxTier => TIER_ORDER.includes(v as FxTier);

/** `?fx=full|lite|off|auto` overrides the saved choice for this page (handy for testing). */
function urlPreference(): FxPreference | null {
  try {
    const value = new URLSearchParams(window.location.search).get("fx");
    return isPreference(value) ? value : null;
  } catch {
    return null;
  }
}

export interface FxState {
  preference: FxPreference;
  /** Set when a URL parameter forces the preference. */
  forced: boolean;
  tier: FxTier;
  /** The tier Auto picks, and why. Null until the device has been probed. */
  auto: { tier: FxTier; reason: string } | null;
  /** Auto stepped down because frames were slow. */
  slowedDown: boolean;
  reducedMotion: boolean;
}

let device: DeviceInfo | null = null;
let state: FxState = initialState();
const listeners = new Set<() => void>();

function initialState(): FxState {
  const forced = typeof window === "undefined" ? null : urlPreference();
  const saved = typeof window === "undefined" ? null : readStorage(PREFERENCE_KEY);
  return {
    preference: forced ?? (isPreference(saved) ? saved : "auto"),
    forced: forced !== null,
    tier: "static",
    auto: null,
    slowedDown: false,
    reducedMotion:
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false,
  };
}

function cap(): FxTier {
  const saved = readStorage(CAP_KEY);
  return isTier(saved) ? saved : "high";
}

function update(patch: Partial<FxState>): void {
  const next = { ...state, ...patch };
  const canRender = device !== null && device.webgl && device.highp;
  next.tier = next.auto ? tierForPreference(next.preference, next.auto.tier, canRender, cap()) : "static";
  next.slowedDown = next.preference === "auto" && next.auto !== null && next.tier !== next.auto.tier;
  state = next;
  for (const listener of listeners) listener();
}

/** Probes the device (once) and settles the tier. Call after the first paint. */
export function initFx(): void {
  if (state.auto) return;
  device = probeDevice();
  update({ auto: chooseAutoTier(device) });
  if (typeof window.matchMedia === "function") {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    query.addEventListener?.("change", () => update({ reducedMotion: query.matches }));
  }
}

export function getFxState(): FxState {
  return state;
}

export function subscribeFxState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFxState(): FxState {
  return useSyncExternalStore(subscribeFxState, getFxState, getFxState);
}

/** The player picked a setting. Picking again also forgets any automatic slow-down. */
export function setFxPreference(preference: FxPreference): void {
  writeStorage(PREFERENCE_KEY, preference);
  writeStorage(CAP_KEY, null);
  update({ preference, forced: false });
}

/** The engine found frames too slow at `tier`: Auto steps down and remembers it. */
export function reportSlow(tier: FxTier): void {
  if (state.preference !== "auto" || state.tier !== tier) return;
  writeStorage(CAP_KEY, lowerTier(tier));
  update({});
}

/** WebGL failed for good (no context, shader errors): fall back to the static backdrop. */
export function reportFailure(tier: FxTier): void {
  if (state.tier !== tier) return;
  if (state.preference === "auto") writeStorage(CAP_KEY, "static");
  else if (device) device = { ...device, webgl: false };
  update({});
}
