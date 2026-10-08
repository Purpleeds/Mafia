/**
 * The sound engine: one AudioContext, three volume buses (background, effects)
 * into a master volume and a gentle compressor. It follows the game on its own:
 * the background crossfades between day and night with the scene, and the
 * eliminations and saves sound when their visual effects play.
 *
 * Browsers only allow sound after a tap, so nothing is created until the first
 * pointer press or key press; until then the scene is remembered and the
 * background begins as soon as the player interacts.
 */
import { getScene, subscribeFx, subscribeScene, type FxEvent } from "../fx/scene";
import { sceneColors } from "../fx/palette";
import { dayForScene } from "../fx/timeOfDay";
import { Ambience } from "./ambience";
import { effectiveVolume, getAudioSettings, subscribeAudioSettings } from "./settings";
import { playEffect, type EffectName } from "./synth";
import { tickFor } from "./tick";

export interface AudioStats {
  /** "none" until the first tap creates the context. */
  state: AudioContextState | "none";
  unlocked: boolean;
  volume: number;
  muted: boolean;
  /** Is the background being generated right now? */
  ambienceRunning: boolean;
  /** 0 = night, 1 = day. */
  dayAmount: number;
  played: Partial<Record<EffectName, number>>;
}

declare global {
  interface Window {
    /** Sound stats, for debugging and browser tests. */
    __mafiaAudio?: AudioStats;
  }
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

const GESTURES = ["pointerdown", "touchend", "keydown", "click"] as const;
/** Things that make a click sound when pressed. */
const CLICKABLE = "button, a[href], summary, select, [role='button'], [role='tab'], [role='switch'], input[type='checkbox'], input[type='radio'], .pcard";

const AMBIENCE_LEVEL = 0.5;
const EFFECTS_LEVEL = 0.9;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private ambience: Ambience | null = null;
  private scheduler: number | undefined;
  private suspendTimer: number | undefined;
  private unlocked = false;
  private started = false;
  private clickCount = 0;
  private readonly played: Partial<Record<EffectName, number>> = {};

  /** Starts listening for the first tap, the scene, and the settings. Safe to call more than once. */
  init(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    const unlock = () => this.unlock();
    for (const gesture of GESTURES) window.addEventListener(gesture, unlock, { capture: true, passive: true });
    document.addEventListener("pointerdown", (event) => this.onPress(event), { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => this.apply());
    subscribeAudioSettings(() => this.apply());
    subscribeScene(() => this.applyScene(false));
    subscribeFx((event) => this.onFx(event));
    this.publish();
  }

  // ------------------------------------------------------------------ unlocking

  /** Creates the context on the first tap (and wakes it again after a pause). */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: "interactive" });
      } catch {
        return;
      }
      this.buildGraph(this.ctx);
      this.unlocked = true;
      this.applyScene(true);
    }
    this.apply();
  }

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 20;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.25;
    const ambienceBus = ctx.createGain();
    const effectsBus = ctx.createGain();
    ambienceBus.gain.value = AMBIENCE_LEVEL;
    effectsBus.gain.value = EFFECTS_LEVEL;
    ambienceBus.connect(master);
    effectsBus.connect(master);
    master.connect(compressor).connect(ctx.destination);
    master.gain.value = 0;
    this.master = master;
    this.ambienceBus = ambienceBus;
    this.effectsBus = effectsBus;
    this.ambience = new Ambience(ctx, ambienceBus);
  }

  // ------------------------------------------------------------------ following the settings

  private visible(): boolean {
    return typeof document === "undefined" || document.visibilityState !== "hidden";
  }

  /** Brings the speakers in line with the volume, mute, background and visibility. */
  private apply(): void {
    const { ctx, master, ambienceBus } = this;
    if (!ctx || !master || !ambienceBus || ctx.state === "closed") return;
    const settings = getAudioSettings();
    const volume = effectiveVolume(settings);
    const awake = this.visible() && volume > 0;
    const now = ctx.currentTime;

    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(volume, now, 0.04);
    ambienceBus.gain.setTargetAtTime(settings.ambience ? AMBIENCE_LEVEL : 0, now, 0.3);

    window.clearTimeout(this.suspendTimer);
    if (awake) {
      if (ctx.state !== "running") void ctx.resume().then(() => this.publish(), () => undefined);
      this.ambience?.start();
      this.startScheduler(settings.ambience);
    } else {
      this.stopScheduler();
      // Let the fade finish, then stop the audio hardware to save battery.
      this.suspendTimer = window.setTimeout(() => {
        if (this.ctx && this.ctx.state === "running") void this.ctx.suspend().then(() => this.publish(), () => undefined);
      }, 350);
    }
    this.publish();
  }

  private startScheduler(wanted: boolean): void {
    if (!wanted) {
      this.stopScheduler();
      return;
    }
    if (this.scheduler !== undefined) return;
    const tick = () => {
      if (this.ctx && this.ambience) this.ambience.scheduleUntil(this.ctx.currentTime + 1.5);
    };
    tick();
    this.scheduler = window.setInterval(tick, 300);
  }

  private stopScheduler(): void {
    if (this.scheduler !== undefined) window.clearInterval(this.scheduler);
    this.scheduler = undefined;
  }

  // ------------------------------------------------------------------ following the game

  /** Crossfades the background to match the sky. `instant` skips the fade (the very first time). */
  private applyScene(instant: boolean): void {
    if (!this.ambience) return;
    const scene = getScene();
    const colors = sceneColors(dayForScene(scene), scene.mode === "normal" ? 1 : 0);
    this.ambience.setMix(colors.dayAmount, scene.mode, instant ? 0 : 3.5);
    this.publish();
  }

  private onFx(event: FxEvent): void {
    if (event.kind === "save") {
      this.play("heal", 0.45);
    } else if (event.mode === "normal") {
      this.play("sting", 0);
      this.duck(2.4);
    } else {
      this.play("poof", 0.3);
    }
  }

  /** Quiets the background for a moment, so a sting or a tune stands out. */
  duck(seconds: number): void {
    const { ctx, ambienceBus } = this;
    if (!ctx || !ambienceBus) return;
    const settings = getAudioSettings();
    const now = ctx.currentTime;
    ambienceBus.gain.setTargetAtTime(settings.ambience ? AMBIENCE_LEVEL * 0.25 : 0, now, 0.08);
    ambienceBus.gain.setTargetAtTime(settings.ambience ? AMBIENCE_LEVEL : 0, now + seconds, 0.6);
  }

  // ------------------------------------------------------------------ one-off sounds

  /** Plays an effect `delaySeconds` from now, if effects are on and sound isn't muted. */
  play(name: EffectName, delaySeconds = 0): void {
    const { ctx, effectsBus } = this;
    if (!ctx || !effectsBus || ctx.state === "closed" || !this.visible()) return;
    const settings = getAudioSettings();
    if (!settings.effects || effectiveVolume(settings) <= 0) return;
    if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
    playEffect(ctx, effectsBus, name, ctx.currentTime + delaySeconds + 0.005, this.clickCount++);
    this.played[name] = (this.played[name] ?? 0) + 1;
    this.publish();
  }

  /** A press on anything clickable gets a click, unless it makes a sound of its own. */
  private onPress(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest(CLICKABLE);
    if (!el || el.closest("[data-sound='none']")) return;
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
    this.play("click");
  }

  /** The countdown shows `secondsLeft`: tick if it is one of the last ten. */
  tick(secondsLeft: number): void {
    const which = tickFor(secondsLeft);
    if (which) this.play(which);
  }

  /** The game is over: a fanfare for the winners, a sad tune for the rest. */
  ending(won: boolean, mode: "safe" | "normal"): void {
    const name: EffectName = won
      ? mode === "safe"
        ? "victorySafe"
        : "victoryNormal"
      : mode === "safe"
        ? "defeatSafe"
        : "defeatNormal";
    this.duck(4);
    this.play(name, 0.15);
  }

  // ------------------------------------------------------------------ debugging

  stats(): AudioStats {
    const settings = getAudioSettings();
    return {
      state: this.ctx?.state ?? "none",
      unlocked: this.unlocked,
      volume: settings.volume,
      muted: settings.muted,
      ambienceRunning: this.scheduler !== undefined,
      dayAmount: Math.round((this.ambience?.dayAmount ?? 0) * 100) / 100,
      played: { ...this.played },
    };
  }

  private publish(): void {
    if (typeof window !== "undefined") window.__mafiaAudio = this.stats();
  }
}

export const audio = new AudioEngine();

/** Starts the sound engine (listening for the first tap). Call once at start-up. */
export function initAudio(): void {
  audio.init();
}

/** The sounds screens can ask for directly. */
export const sounds = {
  /** A vote was accepted. */
  vote: () => audio.play("vote"),
  /** The countdown now shows this many seconds. */
  tick: (secondsLeft: number) => audio.tick(secondsLeft),
  /** The game ended. */
  ending: (won: boolean, mode: "safe" | "normal") => audio.ending(won, mode),
};
