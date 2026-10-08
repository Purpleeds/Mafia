/**
 * Every sound in the game is made here, in code, with the Web Audio API:
 * oscillators, noise and filters. There are no audio files, so there is nothing
 * to license, download or track. Each function schedules one sound on any
 * AudioContext (the live one, or an OfflineAudioContext for tests) into `out`,
 * starting at time `t`, and returns how long it lasts in seconds.
 */

const FLOOR = 0.0001;

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export interface VoiceSpec {
  type: OscillatorType;
  freq: number;
  /** Glide to this frequency over `glide` seconds (default: the whole note). */
  freqEnd?: number;
  glide?: number;
  t: number;
  dur: number;
  /** Peak level, 0..1. */
  gain: number;
  attack?: number;
  /** Seconds to stay at the peak before fading (pads, held chords). */
  hold?: number;
  detune?: number;
  vibrato?: { rate: number; cents: number };
  lowpass?: number | { from: number; to: number };
  highpass?: number;
  pan?: number;
}

/** One oscillator through an optional filter and a gain envelope. */
export function voice(ctx: BaseAudioContext, out: AudioNode, s: VoiceSpec): void {
  const { t, dur } = s;
  const osc = ctx.createOscillator();
  osc.type = s.type;
  osc.frequency.setValueAtTime(s.freq, t);
  if (s.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, s.freqEnd), t + (s.glide ?? dur));
  if (s.detune) osc.detune.value = s.detune;
  const stopAt = t + dur + 0.06;

  if (s.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = s.vibrato.rate;
    depth.gain.value = s.vibrato.cents;
    lfo.connect(depth).connect(osc.detune);
    lfo.start(t);
    lfo.stop(stopAt);
  }

  let tail: AudioNode = osc;
  if (s.highpass) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = s.highpass;
    tail.connect(hp);
    tail = hp;
  }
  if (s.lowpass !== undefined) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    if (typeof s.lowpass === "number") lp.frequency.value = s.lowpass;
    else {
      lp.frequency.setValueAtTime(s.lowpass.from, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(20, s.lowpass.to), t + dur);
    }
    tail.connect(lp);
    tail = lp;
  }

  const attack = Math.min(s.attack ?? 0.005, dur / 2);
  const env = ctx.createGain();
  env.gain.setValueAtTime(FLOOR, t);
  env.gain.linearRampToValueAtTime(s.gain, t + attack);
  if (s.hold) env.gain.setValueAtTime(s.gain, t + attack + Math.min(s.hold, dur - attack));
  env.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
  tail.connect(env);
  tail = env;

  if (s.pan !== undefined && typeof ctx.createStereoPanner === "function") {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, s.pan));
    tail.connect(panner);
    tail = panner;
  }
  tail.connect(out);
  osc.start(t);
  osc.stop(stopAt);
}

const noiseBuffers = new WeakMap<BaseAudioContext, { white: AudioBuffer; brown: AudioBuffer }>();

/** Two seconds of white noise and of brown (rumbly) noise, made once per context. */
export function noiseBuffersFor(ctx: BaseAudioContext): { white: AudioBuffer; brown: AudioBuffer } {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const length = Math.round(ctx.sampleRate * 2);
  const white = ctx.createBuffer(1, length, ctx.sampleRate);
  const brown = ctx.createBuffer(1, length, ctx.sampleRate);
  const w = white.getChannelData(0);
  const b = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const r = Math.random() * 2 - 1;
    w[i] = r;
    last = (last + 0.02 * r) / 1.02;
    b[i] = last * 3.5;
  }
  const buffers = { white, brown };
  noiseBuffers.set(ctx, buffers);
  return buffers;
}

export interface NoiseSpec {
  t: number;
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  attack?: number;
}

/** A burst of filtered noise (a puff, a thump, a snare). */
export function noiseBurst(ctx: BaseAudioContext, out: AudioNode, s: NoiseSpec): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffersFor(ctx).white;
  const filter = ctx.createBiquadFilter();
  filter.type = s.filter;
  filter.Q.value = s.q ?? 0.8;
  filter.frequency.setValueAtTime(s.from, s.t);
  if (s.to !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, s.to), s.t + s.dur);
  const env = ctx.createGain();
  const attack = Math.min(s.attack ?? 0.004, s.dur / 2);
  env.gain.setValueAtTime(FLOOR, s.t);
  env.gain.linearRampToValueAtTime(s.gain, s.t + attack);
  env.gain.exponentialRampToValueAtTime(FLOOR, s.t + s.dur);
  src.connect(filter).connect(env).connect(out);
  src.start(s.t, Math.random() * 0.8);
  src.stop(s.t + s.dur + 0.05);
}

// ------------------------------------------------------------------ interface sounds

/** A small, soft click. `variant` nudges the pitch so repeated clicks don't sound identical. */
export function click(ctx: BaseAudioContext, out: AudioNode, t: number, variant = 0): number {
  const f = 1250 * (1 + (variant % 5) * 0.015);
  voice(ctx, out, { type: "triangle", freq: f, freqEnd: f * 0.7, glide: 0.04, t, dur: 0.06, gain: 0.22, attack: 0.002 });
  noiseBurst(ctx, out, { t, dur: 0.02, gain: 0.08, filter: "highpass", from: 3500 });
  return 0.1;
}

/** A vote landing: a soft thock and a little rising blip. */
export function vote(ctx: BaseAudioContext, out: AudioNode, t: number): number {
  voice(ctx, out, { type: "sine", freq: 170, freqEnd: 90, glide: 0.09, t, dur: 0.14, gain: 0.5, attack: 0.002 });
  noiseBurst(ctx, out, { t, dur: 0.05, gain: 0.14, filter: "lowpass", from: 1800, to: 500 });
  voice(ctx, out, { type: "triangle", freq: 520, freqEnd: 880, glide: 0.1, t: t + 0.07, dur: 0.18, gain: 0.2, attack: 0.004 });
  voice(ctx, out, { type: "sine", freq: 1320, t: t + 0.11, dur: 0.2, gain: 0.08, attack: 0.004 });
  return 0.35;
}

/** One tick of the last-ten-seconds countdown; the last three are higher and firmer. */
export function tick(ctx: BaseAudioContext, out: AudioNode, t: number, urgent: boolean): number {
  const f = urgent ? 1560 : 980;
  voice(ctx, out, { type: "sine", freq: f, t, dur: 0.07, gain: urgent ? 0.3 : 0.2, attack: 0.001 });
  noiseBurst(ctx, out, { t, dur: 0.035, gain: urgent ? 0.18 : 0.12, filter: "bandpass", from: f * 1.4, q: 3 });
  if (urgent) voice(ctx, out, { type: "sine", freq: f * 2, t, dur: 0.05, gain: 0.08, attack: 0.001 });
  return 0.1;
}

// ------------------------------------------------------------------ eliminations and saves

/** Safe Mode: a cartoon poof of smoke with a boing and a little sparkle on the way out. */
export function poof(ctx: BaseAudioContext, out: AudioNode, t: number): number {
  noiseBurst(ctx, out, { t, dur: 0.5, gain: 0.5, filter: "lowpass", from: 5200, to: 260, q: 0.6, attack: 0.012 });
  noiseBurst(ctx, out, { t, dur: 0.12, gain: 0.25, filter: "bandpass", from: 1800, q: 1.2 });
  voice(ctx, out, { type: "sine", freq: 900, freqEnd: 600, glide: 0.04, t, dur: 0.08, gain: 0.35, attack: 0.002 });
  // the boing: a quick wobble that slides down
  voice(ctx, out, {
    type: "sine",
    freq: 760,
    freqEnd: 190,
    glide: 0.45,
    t: t + 0.04,
    dur: 0.55,
    gain: 0.3,
    attack: 0.006,
    vibrato: { rate: 14, cents: 90 },
  });
  voice(ctx, out, { type: "triangle", freq: 1520, freqEnd: 380, glide: 0.45, t: t + 0.04, dur: 0.5, gain: 0.07, attack: 0.006 });
  // sparkle
  [2093, 1760, 1397, 1175].forEach((f, i) => {
    voice(ctx, out, { type: "sine", freq: f, t: t + 0.32 + i * 0.09, dur: 0.32, gain: 0.07, attack: 0.004 });
  });
  return 1.1;
}

/** Normal Mode: a dramatic sting. A heavy hit, a dark minor chord and a nervous high shiver. */
export function sting(ctx: BaseAudioContext, out: AudioNode, t: number): number {
  // the hit
  voice(ctx, out, { type: "sine", freq: 110, freqEnd: 38, glide: 0.3, t, dur: 0.9, gain: 0.7, attack: 0.003 });
  noiseBurst(ctx, out, { t, dur: 0.35, gain: 0.5, filter: "lowpass", from: 1400, to: 90, q: 0.7, attack: 0.002 });
  // the chord: A minor with a low root, detuned saws closing like a door
  for (const [midi, gain] of [
    [33, 0.22],
    [45, 0.16],
    [48, 0.12],
    [52, 0.12],
    [57, 0.1],
  ] as const) {
    for (const detune of [-9, 9]) {
      voice(ctx, out, {
        type: "sawtooth",
        freq: midiToHz(midi),
        t,
        dur: 2.1,
        gain: gain / 2,
        attack: 0.004,
        detune,
        lowpass: { from: 2600, to: 160 },
      });
    }
  }
  // the shiver: two notes a semitone apart with a fast tremolo
  for (const midi of [86, 87]) {
    voice(ctx, out, {
      type: "sawtooth",
      freq: midiToHz(midi),
      t: t + 0.05,
      dur: 1.6,
      gain: 0.035,
      attack: 0.05,
      vibrato: { rate: 7, cents: 35 },
      lowpass: 5200,
      pan: midi === 86 ? -0.5 : 0.5,
    });
  }
  return 2.2;
}

/** The Doctor saves someone: a warm, rising chime. */
export function heal(ctx: BaseAudioContext, out: AudioNode, t: number): number {
  [72, 76, 79, 84, 88].forEach((midi, i) => {
    const at = t + i * 0.1;
    voice(ctx, out, { type: "sine", freq: midiToHz(midi), t: at, dur: 1.1 - i * 0.08, gain: 0.2, attack: 0.006 });
    voice(ctx, out, { type: "triangle", freq: midiToHz(midi + 12), t: at, dur: 0.7, gain: 0.04, attack: 0.006 });
  });
  voice(ctx, out, { type: "sine", freq: midiToHz(60), t, dur: 1.6, gain: 0.14, attack: 0.15, hold: 0.5 });
  voice(ctx, out, { type: "sine", freq: midiToHz(67), t, dur: 1.6, gain: 0.1, attack: 0.15, hold: 0.5 });
  return 1.7;
}

// ------------------------------------------------------------------ the end of the game

export interface Note {
  /** MIDI note numbers played together. */
  midi: readonly number[];
  /** Start, in beats. */
  at: number;
  /** Length, in beats. */
  beats: number;
}

export interface Tune {
  bpm: number;
  notes: readonly Note[];
  /** Voice used for the melody (the top note of each chord) and for the other notes. */
  lead: { type: OscillatorType; gain: number; lowpass?: number; vibrato?: { rate: number; cents: number } };
  pad: { type: OscillatorType; gain: number; lowpass?: number };
  /** Drum hits (beats). */
  hits?: readonly number[];
}

/** The tunes for the end of the game: bright for Safe Mode, darker for Normal. */
export const TUNES = {
  victory: {
    safe: {
      bpm: 132,
      lead: { type: "triangle", gain: 0.22 },
      pad: { type: "square", gain: 0.04, lowpass: 1800 },
      hits: [0, 1, 2, 3],
      notes: [
        { midi: [67], at: 0, beats: 0.5 },
        { midi: [72], at: 0.5, beats: 0.5 },
        { midi: [76], at: 1, beats: 0.5 },
        { midi: [79], at: 1.5, beats: 0.5 },
        { midi: [76, 60], at: 2, beats: 0.5 },
        { midi: [79, 64], at: 2.5, beats: 0.5 },
        { midi: [84, 67, 60], at: 3, beats: 2.4 },
        { midi: [88], at: 3.5, beats: 0.4 },
        { midi: [91], at: 3.9, beats: 1.5 },
      ],
    },
    normal: {
      bpm: 96,
      lead: { type: "sawtooth", gain: 0.12, lowpass: 2400, vibrato: { rate: 5, cents: 14 } },
      pad: { type: "sawtooth", gain: 0.05, lowpass: 900 },
      hits: [0, 2],
      notes: [
        { midi: [62, 38], at: 0, beats: 1 },
        { midi: [65], at: 1, beats: 0.5 },
        { midi: [69], at: 1.5, beats: 0.5 },
        { midi: [74, 50, 57], at: 2, beats: 1.5 },
        { midi: [72], at: 3.5, beats: 0.5 },
        { midi: [74, 62, 53], at: 4, beats: 3 },
        { midi: [77], at: 4.5, beats: 2.5 },
      ],
    },
  },
  defeat: {
    safe: {
      bpm: 84,
      lead: { type: "triangle", gain: 0.24, vibrato: { rate: 5.5, cents: 40 } },
      pad: { type: "sine", gain: 0.06 },
      notes: [
        { midi: [70], at: 0, beats: 1 },
        { midi: [69], at: 1, beats: 1 },
        { midi: [68], at: 2, beats: 1 },
        { midi: [67, 55], at: 3, beats: 3 },
      ],
    },
    normal: {
      bpm: 84,
      lead: { type: "sawtooth", gain: 0.1, lowpass: 1500, vibrato: { rate: 4.5, cents: 18 } },
      pad: { type: "sawtooth", gain: 0.06, lowpass: 600 },
      hits: [0],
      notes: [
        { midi: [69, 45], at: 0, beats: 1.5 },
        { midi: [65], at: 1.5, beats: 1 },
        { midi: [64, 52], at: 2.5, beats: 1.5 },
        { midi: [62, 50, 38], at: 4, beats: 4 },
      ],
    },
  },
} as const satisfies Record<"victory" | "defeat", Record<"safe" | "normal", Tune>>;

/** Length of a tune in seconds. */
export function tuneSeconds(tune: Tune): number {
  const beat = 60 / tune.bpm;
  return Math.max(...tune.notes.map((n) => (n.at + n.beats) * beat)) + 0.4;
}

/** Plays a tune: the highest note of each chord is the melody, the rest are a soft pad. */
export function playTune(ctx: BaseAudioContext, out: AudioNode, t: number, tune: Tune): number {
  const beat = 60 / tune.bpm;
  for (const note of tune.notes) {
    const at = t + note.at * beat;
    const dur = Math.max(0.12, note.beats * beat);
    const sorted = [...note.midi].sort((a, b) => b - a);
    sorted.forEach((midi, i) => {
      const lead = i === 0;
      const part = lead ? tune.lead : tune.pad;
      voice(ctx, out, {
        type: part.type,
        freq: midiToHz(midi),
        t: at,
        dur: lead ? dur + 0.12 : dur + 0.3,
        gain: part.gain,
        attack: lead ? 0.008 : 0.04,
        lowpass: part.lowpass,
        vibrato: lead ? tune.lead.vibrato : undefined,
        detune: lead ? 0 : i % 2 === 0 ? -6 : 6,
        pan: lead ? 0 : i % 2 === 0 ? -0.3 : 0.3,
      });
    });
  }
  for (const hit of tune.hits ?? []) {
    const at = t + hit * beat;
    noiseBurst(ctx, out, { t: at, dur: 0.14, gain: 0.16, filter: "bandpass", from: 2400, q: 0.9 });
    voice(ctx, out, { type: "sine", freq: 120, freqEnd: 50, glide: 0.12, t: at, dur: 0.22, gain: 0.3, attack: 0.002 });
  }
  return tuneSeconds(tune);
}

export function victory(ctx: BaseAudioContext, out: AudioNode, t: number, mode: "safe" | "normal"): number {
  return playTune(ctx, out, t, TUNES.victory[mode]);
}

export function defeat(ctx: BaseAudioContext, out: AudioNode, t: number, mode: "safe" | "normal"): number {
  return playTune(ctx, out, t, TUNES.defeat[mode]);
}

export const EFFECTS = ["click", "vote", "tick", "tickUrgent", "poof", "sting", "heal", "victorySafe", "victoryNormal", "defeatSafe", "defeatNormal"] as const;
export type EffectName = (typeof EFFECTS)[number];

/** Plays an effect by name; returns its length in seconds. */
export function playEffect(ctx: BaseAudioContext, out: AudioNode, name: EffectName, t: number, variant = 0): number {
  switch (name) {
    case "click":
      return click(ctx, out, t, variant);
    case "vote":
      return vote(ctx, out, t);
    case "tick":
      return tick(ctx, out, t, false);
    case "tickUrgent":
      return tick(ctx, out, t, true);
    case "poof":
      return poof(ctx, out, t);
    case "sting":
      return sting(ctx, out, t);
    case "heal":
      return heal(ctx, out, t);
    case "victorySafe":
      return victory(ctx, out, t, "safe");
    case "victoryNormal":
      return victory(ctx, out, t, "normal");
    case "defeatSafe":
      return defeat(ctx, out, t, "safe");
    case "defeatNormal":
      return defeat(ctx, out, t, "normal");
  }
}
