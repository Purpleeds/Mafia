/**
 * Runs the WebGL background: follows the game's phase with a smooth day/night
 * change, plays effect pulses, adds a little parallax, and keeps the cost down
 * (about 30 fps when nothing is changing, 60 during transitions, nothing at all
 * while the tab is hidden). If frames come in slow it asks for a lower tier.
 */
import { sceneColors, sceneUnit, sunAndMoon } from "./palette";
import { TIER_SPECS, renderSize, type RenderTier } from "./quality";
import { SkyRenderer, type Vec4 } from "./renderer";
import { getScene, subscribeFx, subscribeScene, type FxEvent } from "./scene";
import { dayForScene, dayTransitionMs, nextDayValue } from "./timeOfDay";
import { buildVillage, rasterizeVillage, type VillageTextures } from "./village";

// ------------------------------------------------------------------ pure helpers

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

const easeInOutCubic = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

function tweenAt(tween: Tween, now: number): number {
  const p = Math.min(1, Math.max(0, (now - tween.start) / tween.duration));
  return tween.from + (tween.to - tween.from) * easeInOutCubic(p);
}

export type PulseKind = "red" | "puff" | "save";

interface PulseSpec {
  color: readonly [number, number, number];
  peak: number;
  attack: number;
  hold: number;
  release: number;
  /** 0 = flush from the edges, 1 = glow from the centre. */
  shape: number;
  ring: number;
  ringSpeed: number;
  ringTime: number;
}

const PULSES: Record<PulseKind, PulseSpec> = {
  // Normal Mode elimination: a dramatic red flush and a shock ring.
  red: { color: [0.86, 0.05, 0.09], peak: 0.9, attack: 0.12, hold: 0.35, release: 1.8, shape: 0, ring: 0.9, ringSpeed: 1.1, ringTime: 1.3 },
  // Safe Mode elimination: a soft pale puff (the smoke itself is drawn over the cards).
  puff: { color: [0.93, 0.9, 1.0], peak: 0.32, attack: 0.3, hold: 0.2, release: 1.5, shape: 1, ring: 0.25, ringSpeed: 0.7, ringTime: 1.4 },
  // The Doctor saved someone: a soft green glow, both modes.
  save: { color: [0.33, 1.0, 0.58], peak: 0.75, attack: 0.6, hold: 0.7, release: 2.4, shape: 1, ring: 0.5, ringSpeed: 0.75, ringTime: 1.8 },
};

export function pulseKind(event: FxEvent): PulseKind {
  return event.kind === "save" ? "save" : event.mode === "normal" ? "red" : "puff";
}

/** Uniform values for a pulse `elapsed` seconds in, or null once it's over. */
export function pulseValues(kind: PulseKind, elapsed: number): { pulse: Vec4; ring: [number, number, number] } | null {
  const s = PULSES[kind];
  const total = s.attack + s.hold + s.release;
  if (elapsed < 0 || elapsed >= Math.max(total, s.ringTime)) return null;
  let amount: number;
  if (elapsed < s.attack) amount = elapsed / s.attack;
  else if (elapsed < s.attack + s.hold) amount = 1;
  else amount = Math.max(0, 1 - (elapsed - s.attack - s.hold) / s.release);
  amount = amount * amount * (3 - 2 * amount) * s.peak;
  const ringP = Math.min(1, elapsed / s.ringTime);
  return {
    pulse: [s.color[0], s.color[1], s.color[2], amount],
    ring: [0.04 + ringP * s.ringSpeed, s.ring * (1 - ringP) * Math.min(1, elapsed / 0.08), s.shape],
  };
}

/** Frame intervals (ms) that say the GPU can't keep up: the median is well over a 45 fps frame. */
export function isSlow(intervals: readonly number[]): boolean {
  if (intervals.length < 20) return false;
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  // The fastest frames show the display's own pace: 60 Hz or more, or 30 Hz in a
  // phone's Low Power Mode. Nothing runs slower than 30 Hz on purpose.
  const fastest = sorted[Math.floor(sorted.length / 10)] ?? 0;
  return median > Math.max(22, Math.min(fastest, 34) * 1.4);
}

// ------------------------------------------------------------------ engine

const textureCache = new Map<number, VillageTextures>();

function villageTextures(scale: number): VillageTextures {
  let textures = textureCache.get(scale);
  if (!textures) {
    textures = rasterizeVillage(buildVillage(), scale);
    textureCache.set(scale, textures);
  }
  return textures;
}

export interface FxStats {
  tier: RenderTier;
  frames: number;
  fps: number;
  width: number;
  height: number;
  scale: number;
  day: number;
  mode: number;
  reducedMotion: boolean;
  running: boolean;
}

declare global {
  interface Window {
    /** Background stats, for debugging and browser tests. */
    __mafiaFx?: FxStats;
  }
}

export interface EngineOptions {
  tier: RenderTier;
  reducedMotion: boolean;
  /** The player asked for this tier, so don't refuse a slow (software) GPU. */
  allowSlow: boolean;
  /** Watch the frame rate and call onSlow (only for Auto). */
  watchSpeed: boolean;
  onReady(): void;
  onSlow(): void;
  onFailure(error: unknown): void;
}

const TAU = Math.PI * 2;

export class FxEngine {
  private renderer: SkyRenderer | null;
  private readonly cleanups: Array<() => void> = [];
  private raf = 0;
  private running = false;
  private disposed = false;
  private ready = false;

  private width = 1;
  private height = 1;
  private scale = 1;

  /** Animation time in seconds; it stops while the tab is hidden. */
  private clock = 0;
  private lastFrameAt = 0;
  private lastDrawAt = 0;

  private day: number;
  private dayTween: Tween | null = null;
  private mode: number;
  private modeTween: Tween | null = null;
  private pulse: { kind: PulseKind; start: number } | null = null;

  private parallax = 0;
  private parallaxTarget = 0;

  private intervals: number[] = [];
  private watchFrom = 0;
  private slowWindows = 0;
  private frames = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private fps = 0;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: EngineOptions,
  ) {
    const scene = getScene();
    this.day = dayForScene(scene);
    this.mode = scene.mode === "normal" ? 1 : 0;
    this.renderer = this.createRenderer();

    this.listen(subscribeScene(() => this.onScene()));
    this.listen(subscribeFx((event) => this.onFx(event)));

    const resize = new ResizeObserver(() => this.resize());
    resize.observe(canvas);
    this.listen(() => resize.disconnect());

    this.on(document, "visibilitychange", () => (document.hidden ? this.stop() : this.start()));
    this.on(window, "pointermove", (event) => {
      const e = event as PointerEvent;
      if (e.pointerType !== "mouse" || options.reducedMotion) return;
      this.parallaxTarget = Math.max(-1, Math.min(1, (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1));
      if (!this.running && !document.hidden) this.start();
    });
    this.on(canvas, "webglcontextlost", (event) => {
      event.preventDefault();
      this.stop();
      this.renderer = null;
      this.lostTimer = setTimeout(() => this.fail(new Error("WebGL context lost")), 4000);
    });
    this.on(canvas, "webglcontextrestored", () => {
      if (this.lostTimer) clearTimeout(this.lostTimer);
      this.lostTimer = null;
      try {
        this.renderer = this.createRenderer();
        this.resize();
        this.start();
      } catch (error) {
        this.fail(error);
      }
    });

    this.resize();
    this.start();
  }

  private createRenderer(): SkyRenderer {
    const spec = TIER_SPECS[this.options.tier];
    const renderer = new SkyRenderer(this.canvas, spec.shader, buildVillage().windmill, {
      allowSlow: this.options.allowSlow,
    });
    renderer.setTextures(villageTextures(spec.textureScale));
    return renderer;
  }

  private listen(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  private on(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    this.listen(() => target.removeEventListener(type, handler));
  }

  private fail(error: unknown): void {
    if (this.disposed) return;
    this.stop();
    this.options.onFailure(error);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const size = renderSize(rect.width, rect.height, window.devicePixelRatio || 1, this.options.tier);
    this.width = size.width;
    this.height = size.height;
    this.scale = size.scale;
    this.renderer?.setSize(size.width, size.height);
    // Measuring right after a resize would count the reallocation as slowness.
    this.watchFrom = performance.now() + 1500;
    this.intervals = [];
    this.drawFrame(performance.now());
  }

  start(): void {
    if (this.running || this.disposed || !this.renderer || document.hidden) return;
    if (this.options.reducedMotion) {
      // Reduced motion: no animation loop, just draw when something changes.
      this.drawFrame(performance.now());
      return;
    }
    this.running = true;
    this.lastFrameAt = 0;
    this.watchFrom = performance.now() + 2000;
    this.intervals = [];
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.publishStats();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    if (this.lostTimer) clearTimeout(this.lostTimer);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.renderer?.dispose();
    this.renderer = null;
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.lastFrameAt > 0) this.watch(now - this.lastFrameAt, now);
    this.lastFrameAt = now;
    // 60 fps while something moves, 30 fps when the scene is calm.
    const gap = this.isAnimating(now) ? 14 : 30;
    if (now - this.lastDrawAt < gap) return;
    const step = Math.min(0.1, (now - this.lastDrawAt) / 1000);
    this.clock += step;
    this.drawFrame(now, step);
  };

  private watch(interval: number, now: number): void {
    if (!this.options.watchSpeed || now < this.watchFrom || interval > 250) return;
    this.intervals.push(interval);
    if (this.intervals.length < 90) return;
    const slow = isSlow(this.intervals);
    this.intervals = [];
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    if (this.slowWindows >= 2) {
      this.slowWindows = 0;
      this.watchFrom = now + 5000;
      this.options.onSlow();
    }
  }

  private isAnimating(now: number): boolean {
    return (
      (this.dayTween !== null && now < this.dayTween.start + this.dayTween.duration) ||
      (this.modeTween !== null && now < this.modeTween.start + this.modeTween.duration) ||
      this.pulse !== null ||
      Math.abs(this.parallaxTarget - this.parallax) > 0.002
    );
  }

  private currentDay(now: number): number {
    if (!this.dayTween) return this.day;
    const value = tweenAt(this.dayTween, now);
    if (now >= this.dayTween.start + this.dayTween.duration) {
      this.day = this.dayTween.to;
      this.dayTween = null;
    }
    return value;
  }

  private currentMode(now: number): number {
    if (!this.modeTween) return this.mode;
    const value = tweenAt(this.modeTween, now);
    if (now >= this.modeTween.start + this.modeTween.duration) {
      this.mode = this.modeTween.to;
      this.modeTween = null;
    }
    return value;
  }

  private onScene(): void {
    const scene = getScene();
    const now = performance.now();
    const from = this.currentDay(now);
    const to = nextDayValue(from, dayForScene(scene));
    const modeFrom = this.currentMode(now);
    const modeTo = scene.mode === "normal" ? 1 : 0;
    if (this.options.reducedMotion) {
      this.day = to;
      this.dayTween = null;
      this.mode = modeTo;
      this.modeTween = null;
      this.drawFrame(now);
      return;
    }
    if (Math.abs(to - from) > 1e-4) {
      this.day = from;
      this.dayTween = { from, to, start: now, duration: dayTransitionMs(to - from) };
    }
    if (modeTo !== modeFrom) {
      this.mode = modeFrom;
      this.modeTween = { from: modeFrom, to: modeTo, start: now, duration: 1600 };
    }
  }

  private onFx(event: FxEvent): void {
    // With reduced motion the screens show the moment without the flash.
    if (this.options.reducedMotion) return;
    this.pulse = { kind: pulseKind(event), start: performance.now() };
  }

  /** Draws one frame; `step` is the animation time (s) since the last one. */
  private drawFrame(now: number, step = 0): void {
    const renderer = this.renderer;
    if (!renderer || this.disposed) return;
    this.lastDrawAt = now;
    const day = this.currentDay(now);
    const mode = this.currentMode(now);
    const unit = sceneUnit(this.width, this.height);
    const { sun, moon } = sunAndMoon(day, { width: this.width / unit, height: this.height / unit });

    this.parallax += (this.parallaxTarget - this.parallax) * (1 - Math.exp(-step * 5));
    const sway = this.options.reducedMotion ? 0 : Math.sin((this.clock * TAU) / 50) * 0.35;
    const p = this.parallax + sway;
    const t = this.clock;

    let pulse: Vec4 = [0, 0, 0, 0];
    let ring: Vec4 = [0, 0, 0, (t * 0.35) % (Math.PI / 2)];
    if (this.pulse) {
      const values = pulseValues(this.pulse.kind, (now - this.pulse.start) / 1000);
      if (values) {
        pulse = values.pulse;
        ring = [values.ring[0], values.ring[1], values.ring[2], ring[3]];
      } else {
        this.pulse = null;
      }
    }

    renderer.draw({
      unit,
      time: this.options.reducedMotion ? 20 : t % 3600,
      colors: sceneColors(day, mode),
      sun,
      moon,
      parallax: [p * 0.006, p * 0.012, p * 0.026, p * 0.05],
      drift: [(t * 0.012) % 256, (t * 0.03) % 256, (t * 0.045) % 256, (t * 0.06) % 256],
      pulse,
      ring,
    });

    this.frames += 1;
    this.fpsFrames += 1;
    if (now - this.fpsSince >= 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / Math.max(1, now - this.fpsSince));
      this.fpsFrames = 0;
      this.fpsSince = now;
      this.publishStats(day, mode);
    }
    if (!this.ready) {
      this.ready = true;
      this.publishStats(day, mode);
      this.options.onReady();
    }
  }

  private publishStats(day = this.day, mode = this.mode): void {
    window.__mafiaFx = {
      tier: this.options.tier,
      frames: this.frames,
      fps: this.fps,
      width: this.width,
      height: this.height,
      scale: Math.round(this.scale * 100) / 100,
      day: Math.round(day * 1000) / 1000,
      mode,
      reducedMotion: this.options.reducedMotion,
      running: this.running,
    };
  }
}
