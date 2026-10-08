/**
 * The village's background sound, generated live: wind and birdsong by day,
 * crickets and the odd owl by night, crossfading as the sky changes. It is
 * procedural (nothing is recorded), so it never loops audibly.
 *
 *   day   = wind (a soft band of brown noise that drifts) + birds
 *   night = low wind + a few crickets + an owl now and then
 *
 * Safe Mode is bright and busy with birds; Normal Mode has more wind, fewer
 * birds and more owls.
 */
import { noiseBuffersFor, voice } from "./synth";

export type AmbienceStyle = "safe" | "normal";

type Random = () => number;

interface StyleTuning {
  /** Typical seconds between bird phrases by day. */
  birdEvery: number;
  /** Typical seconds between owl calls at night. */
  owlEvery: number;
  /** How loud the wind is, as a multiple of the base level. */
  windDay: number;
  windNight: number;
  birdGain: number;
}

const TUNING: Record<AmbienceStyle, StyleTuning> = {
  safe: { birdEvery: 1.8, owlEvery: 16, windDay: 0.8, windNight: 0.8, birdGain: 1 },
  normal: { birdEvery: 4.5, owlEvery: 9, windDay: 1.15, windNight: 1.2, birdGain: 0.85 },
};

const CRICKETS = [
  { freq: 4380, every: 0.62, pan: -0.6 },
  { freq: 4720, every: 0.51, pan: 0.45 },
  { freq: 5110, every: 0.73, pan: 0.1 },
] as const;

/** Equal-power crossfade gains for a day amount of 0 (night) .. 1 (day). */
export function crossfadeGains(day: number): { day: number; night: number } {
  const d = Math.min(1, Math.max(0, day));
  return { day: Math.sin((d * Math.PI) / 2), night: Math.cos((d * Math.PI) / 2) };
}

export class Ambience {
  private readonly dayGain: GainNode;
  private readonly nightGain: GainNode;
  private readonly dayWind: GainNode;
  private readonly nightWind: GainNode;
  private readonly owlBus: GainNode;
  private readonly cricketGains: GainNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private day = 0.5;
  private style: AmbienceStyle = "safe";
  private started = false;
  private nextBird = 0;
  private nextOwl = 0;
  private readonly nextChirp: number[] = CRICKETS.map(() => 0);

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    private readonly random: Random = Math.random,
  ) {
    this.dayGain = ctx.createGain();
    this.nightGain = ctx.createGain();
    this.owlBus = ctx.createGain();
    this.dayWind = ctx.createGain();
    this.nightWind = ctx.createGain();
    this.dayWind.connect(this.dayGain);
    this.nightWind.connect(this.nightGain);
    this.dayGain.connect(out);
    this.nightGain.connect(out);

    // The owl's calls echo a little, as if across a valley.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.24;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.owlBus.connect(this.nightGain);
    this.owlBus.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(this.nightGain);
    this.nodes.push(delay, feedback, wet);
    this.applyMix(0);
  }

  /** Builds the always-on layers (the wind and the crickets) and starts scheduling. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const { ctx } = this;
    const now = ctx.currentTime;

    const brown = noiseBuffersFor(ctx).brown;
    const wind = (target: GainNode, kind: BiquadFilterType, base: number, level: number, lfoRate: number) => {
      const src = ctx.createBufferSource();
      src.buffer = brown;
      src.loop = true;
      // Brown noise rumbles far below what speakers can play; cut it so it doesn't eat headroom.
      const rumble = ctx.createBiquadFilter();
      rumble.type = "highpass";
      rumble.frequency.value = 75;
      const filter = ctx.createBiquadFilter();
      filter.type = kind;
      filter.frequency.value = base;
      filter.Q.value = kind === "bandpass" ? 0.7 : 0.5;
      const swell = ctx.createGain();
      swell.gain.value = level;
      // a slow breathing of the wind: its loudness and its tone drift together
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const depthGain = ctx.createGain();
      depthGain.gain.value = level * 0.55;
      const depthTone = ctx.createGain();
      depthTone.gain.value = base * 0.4;
      lfo.connect(depthGain).connect(swell.gain);
      lfo.connect(depthTone).connect(filter.frequency);
      src.connect(rumble).connect(filter).connect(swell).connect(target);
      src.start(now, this.random() * 1.5);
      lfo.start(now);
      this.sources.push(src, lfo);
      this.nodes.push(rumble, filter, swell, depthGain, depthTone);
      return swell;
    };
    wind(this.dayWind, "bandpass", 620, 0.2, 0.07);
    wind(this.dayWind, "highpass", 1400, 0.035, 0.11);
    wind(this.nightWind, "lowpass", 300, 0.2, 0.05);

    // Crickets: a steady high note that is switched on and off in short chirps.
    CRICKETS.forEach((c, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = c.freq;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
      if (panner) {
        panner.pan.value = c.pan;
        osc.connect(gain).connect(panner).connect(this.nightGain);
      } else {
        osc.connect(gain).connect(this.nightGain);
      }
      osc.start(now);
      this.sources.push(osc);
      this.cricketGains.push(gain);
      this.nodes.push(gain);
      this.nextChirp[i] = now + this.random() * c.every;
    });

    this.nextBird = now + 0.5 + this.random() * 1.5;
    this.nextOwl = now + 3 + this.random() * 6;
  }

  /** Fades towards `day` (0 = night, 1 = day) and changes the style of the sounds. */
  setMix(day: number, style: AmbienceStyle, rampSeconds = 3): void {
    this.day = Math.min(1, Math.max(0, day));
    this.style = style;
    this.applyMix(rampSeconds);
  }

  private applyMix(rampSeconds: number): void {
    const tuning = TUNING[this.style];
    const windNow = this.ctx.currentTime;
    this.dayWind.gain.setTargetAtTime(tuning.windDay, windNow, Math.max(0.001, rampSeconds / 3));
    this.nightWind.gain.setTargetAtTime(tuning.windNight, windNow, Math.max(0.001, rampSeconds / 3));
    const gains = crossfadeGains(this.day);
    const now = this.ctx.currentTime;
    const tau = Math.max(0.001, rampSeconds / 3);
    this.dayGain.gain.cancelScheduledValues(now);
    this.nightGain.gain.cancelScheduledValues(now);
    if (rampSeconds <= 0) {
      this.dayGain.gain.setValueAtTime(gains.day, now);
      this.nightGain.gain.setValueAtTime(gains.night, now);
    } else {
      this.dayGain.gain.setTargetAtTime(gains.day, now, tau);
      this.nightGain.gain.setTargetAtTime(gains.night, now, tau);
    }
  }

  get dayAmount(): number {
    return this.day;
  }

  /**
   * Schedules every bird phrase, chirp and hoot that falls before `horizon`
   * (seconds on the context's clock). The engine calls this a few times a
   * second, looking about a second ahead.
   */
  scheduleUntil(horizon: number): void {
    if (!this.started) return;
    const tuning = TUNING[this.style];
    const gains = crossfadeGains(this.day);

    while (this.nextBird < horizon) {
      if (gains.day > 0.12) this.bird(this.nextBird, tuning.birdGain * gains.day);
      this.nextBird += tuning.birdEvery * (0.5 + this.random() * 1.4);
    }
    while (this.nextOwl < horizon) {
      if (gains.night > 0.3) this.owl(this.nextOwl, gains.night);
      this.nextOwl += tuning.owlEvery * (0.6 + this.random() * 1.2);
    }
    CRICKETS.forEach((c, i) => {
      let at = this.nextChirp[i] ?? horizon;
      const gain = this.cricketGains[i];
      while (at < horizon && gain) {
        if (gains.night > 0.08) this.chirp(gain, at, 0.065 * gains.night);
        at += c.every * (0.9 + this.random() * 0.25);
      }
      this.nextChirp[i] = at;
    });
  }

  /** A burst of 3 or 4 quick pulses: one cricket's chirp. */
  private chirp(gain: GainNode, t: number, level: number): void {
    const pulses = 3 + Math.floor(this.random() * 2);
    const peak = level * (0.7 + this.random() * 0.5);
    for (let k = 0; k < pulses; k++) {
      const at = t + k * 0.036;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + 0.009);
      gain.gain.linearRampToValueAtTime(0, at + 0.026);
    }
  }

  /** One phrase of birdsong: a tweet, a trill, a whistle or a warble. */
  private bird(t: number, level: number): void {
    const { ctx, random } = this;
    const pan = random() * 1.6 - 0.8;
    const base = 2300 + random() * 2000;
    const peak = (0.09 + random() * 0.08) * level;
    const note = (at: number, from: number, to: number, dur: number, gain = peak, vibrato = false) =>
      voice(ctx, this.dayGain, {
        type: "sine",
        freq: from,
        freqEnd: to,
        t: at,
        dur,
        gain,
        attack: 0.006,
        highpass: 1100,
        lowpass: 7500,
        pan,
        vibrato: vibrato ? { rate: 26, cents: 38 } : undefined,
      });
    const kind = random();
    if (kind < 0.3) {
      // tweet, tweet
      const count = 1 + Math.floor(random() * 3);
      for (let i = 0; i < count; i++) note(t + i * 0.17, base, base * 1.3, 0.085);
    } else if (kind < 0.55) {
      // a trill: many short notes on one pitch
      const count = 7 + Math.floor(random() * 6);
      for (let i = 0; i < count; i++) note(t + i * 0.055, base * (1 + (i % 2) * 0.03), base * 1.02, 0.032, peak * (1 - i / (count * 1.6)));
    } else if (kind < 0.8) {
      // a whistle: down, then up
      note(t, base * 1.35, base * 0.9, 0.16);
      note(t + 0.3, base, base * 1.12, 0.12, peak * 0.9);
    } else {
      // a warble: a quick run of wandering notes
      const count = 5 + Math.floor(random() * 4);
      for (let i = 0; i < count; i++) {
        const f = base * (0.8 + random() * 0.6);
        note(t + i * 0.062, f, f * (0.9 + random() * 0.3), 0.05, peak * 0.9, true);
      }
    }
  }

  /** "hoo, hoo, hoooo": the owl, far across the valley. */
  private owl(t: number, level: number): void {
    const { ctx, random } = this;
    const pan = random() * 1.2 - 0.6;
    const base = 330 + random() * 70;
    const call = (at: number, dur: number, drop: number) => {
      voice(ctx, this.owlBus, {
        type: "sine",
        freq: base,
        freqEnd: base * drop,
        t: at,
        dur,
        gain: 0.16 * level,
        attack: 0.06,
        vibrato: { rate: 5.5, cents: 14 },
        lowpass: 1200,
        pan,
      });
      voice(ctx, this.owlBus, { type: "triangle", freq: base * 2, freqEnd: base * 2 * drop, t: at, dur, gain: 0.025 * level, attack: 0.06, lowpass: 1500, pan });
    };
    call(t, 0.3, 0.94);
    call(t + 0.46, 0.3, 0.94);
    call(t + 0.98, 0.85, 0.82);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.length = 0;
    for (const node of [...this.nodes, ...this.cricketGains]) node.disconnect();
    this.nodes.length = 0;
    this.cricketGains.length = 0;
  }
}

