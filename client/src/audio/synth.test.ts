import { describe, expect, it } from "vitest";
import { EFFECTS, TUNES, midiToHz, noiseBuffersFor, playEffect, tuneSeconds, type EffectName, type Tune } from "./synth";
import { FakeAudioContext, fakeOutput, reachable, type FakeNode } from "./testing/fakeAudio";

const AT = 0.5;

function play(name: EffectName, variant = 0) {
  const ctx = FakeAudioContext.make();
  const out = fakeOutput(ctx);
  const seconds = playEffect(ctx.asContext, out.asNode, name, AT, variant);
  const sources = ctx.nodes.filter((n) => n.startedAt !== null);
  return { ctx, out: out.node, seconds, sources };
}

const oscillatorFrequencies = (sources: FakeNode[]): number[] =>
  sources.filter((n) => n.kind === "oscillator").flatMap((n) => n.frequency.events.map((e) => e.value));

describe("midiToHz", () => {
  it("tunes A4 to 440 Hz and doubles every octave", () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
    expect(midiToHz(57)).toBeCloseTo(220, 6);
    expect(midiToHz(60)).toBeCloseTo(261.626, 2);
  });
});

describe("every effect", () => {
  it.each(EFFECTS)("%s is scheduled correctly (and the browser would accept every value)", (name) => {
    // The fake context throws what real browsers throw, so any bad parameter fails here.
    const { out, seconds, sources } = play(name, 3);
    expect(seconds).toBeGreaterThan(0.05);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.startedAt, `${name}: a sound starts before it was asked to`).toBeGreaterThanOrEqual(AT);
      expect(s.stoppedAt, `${name}: a source is never stopped, so it would keep running`).not.toBeNull();
      expect(s.stoppedAt ?? 0).toBeGreaterThan(s.startedAt ?? 0);
    }
    expect(sources.some((s) => reachable(s).has(out)), `${name} never reaches the output`).toBe(true);
    const lastStop = Math.max(...sources.map((s) => s.stoppedAt ?? 0));
    expect(Math.abs(seconds - (lastStop - AT)), `${name}: the stated length matches what is scheduled`).toBeLessThan(0.4);
  });

  it("starts at the time it is given, so a delayed sound really is delayed", () => {
    const early = play("poof").sources.map((s) => s.startedAt ?? 0);
    const ctx = FakeAudioContext.make();
    const out = fakeOutput(ctx);
    playEffect(ctx.asContext, out.asNode, "poof", AT + 2);
    const late = ctx.nodes.filter((n) => n.startedAt !== null).map((n) => n.startedAt ?? 0);
    expect(Math.min(...late) - Math.min(...early)).toBeCloseTo(2, 6);
  });

  it("never leaves a node unconnected from the sound it makes", () => {
    for (const name of EFFECTS) {
      const { sources } = play(name);
      for (const s of sources.filter((n) => n.kind === "buffer")) expect(s.outputs.length, name).toBeGreaterThan(0);
    }
  });
});

describe("the interface sounds", () => {
  it("the last three ticks are higher and firmer than the others", () => {
    const calm = play("tick");
    const urgent = play("tickUrgent");
    const calmFreq = Math.max(...oscillatorFrequencies(calm.sources));
    const urgentFreq = Math.max(...oscillatorFrequencies(urgent.sources));
    expect(urgentFreq).toBeGreaterThan(calmFreq * 1.4);
    // ...and both are short, so the next tick (a second later) never overlaps
    expect(calm.seconds).toBeLessThan(0.25);
    expect(urgent.seconds).toBeLessThan(0.25);
  });

  it("repeated clicks vary a little in pitch", () => {
    const pitches = [0, 1, 2, 3, 4].map((variant) => Math.max(...oscillatorFrequencies(play("click", variant).sources)));
    expect(new Set(pitches).size).toBe(5);
    expect(Math.max(...pitches) / Math.min(...pitches)).toBeLessThan(1.1);
  });

  it("clicks and ticks are short, so they never pile up", () => {
    for (const name of ["click", "tick", "tickUrgent"] as const) expect(play(name).seconds, name).toBeLessThanOrEqual(0.25);
    expect(play("vote").seconds).toBeLessThan(0.6);
  });
});

describe("eliminations and saves", () => {
  it("Safe Mode's poof is a short, soft cartoon sound: no sawtooth, nothing deep", () => {
    const { sources, seconds } = play("poof");
    expect(sources.filter((n) => n.kind === "oscillator").every((n) => n.type !== "sawtooth")).toBe(true);
    expect(Math.min(...oscillatorFrequencies(sources))).toBeGreaterThanOrEqual(150);
    expect(seconds).toBeLessThan(1.5);
  });

  it("Normal Mode's sting is a longer, darker hit with a deep thud and a sawtooth chord", () => {
    const sting = play("sting");
    const poof = play("poof");
    expect(sting.seconds).toBeGreaterThan(poof.seconds * 1.5);
    expect(Math.min(...oscillatorFrequencies(sting.sources))).toBeLessThan(60);
    expect(sting.sources.filter((n) => n.kind === "oscillator" && n.type === "sawtooth").length).toBeGreaterThanOrEqual(6);
  });

  it("the Doctor's heal chime climbs", () => {
    const { sources } = play("heal");
    const arpeggio = sources
      .filter((n) => n.kind === "oscillator" && n.type === "sine" && (n.startedAt ?? 0) > AT + 0.01)
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
      .map((n) => n.frequency.events[0]?.value ?? 0);
    expect(arpeggio.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < arpeggio.length; i++) expect(arpeggio[i] ?? 0).toBeGreaterThan(arpeggio[i - 1] ?? 0);
  });
});

type TuneEntry = readonly [string, Tune];
const ALL_TUNES: TuneEntry[] = [
  ["victory (Safe)", TUNES.victory.safe],
  ["victory (Normal)", TUNES.victory.normal],
  ["defeat (Safe)", TUNES.defeat.safe],
  ["defeat (Normal)", TUNES.defeat.normal],
];

/** The top note of each chord: the melody. */
const melody = (tune: Tune): number[] =>
  [...tune.notes].sort((a, b) => a.at - b.at).map((n) => Math.max(...n.midi));

describe("the end-of-game tunes", () => {
  it.each(ALL_TUNES)("%s has sensible notes and a sensible length", (_name, tune) => {
    expect(tune.bpm).toBeGreaterThan(50);
    expect(tune.bpm).toBeLessThan(200);
    for (const note of tune.notes) {
      expect(note.at).toBeGreaterThanOrEqual(0);
      expect(note.beats).toBeGreaterThan(0);
      expect(note.midi.length).toBeGreaterThan(0);
      for (const midi of note.midi) {
        expect(midi).toBeGreaterThanOrEqual(30);
        expect(midi).toBeLessThanOrEqual(100);
      }
    }
    expect(tuneSeconds(tune)).toBeGreaterThan(2);
    expect(tuneSeconds(tune)).toBeLessThan(8);
  });

  it("Safe Mode's tunes are soft: no sawtooth voices", () => {
    for (const tune of [TUNES.victory.safe, TUNES.defeat.safe]) {
      expect(tune.lead.type).not.toBe("sawtooth");
      expect(tune.pad.type).not.toBe("sawtooth");
    }
  });

  it("the Safe victory is brighter and quicker than Normal's, and its melody climbs to the top", () => {
    const safe = melody(TUNES.victory.safe);
    const normal = melody(TUNES.victory.normal);
    expect(TUNES.victory.safe.bpm).toBeGreaterThan(TUNES.victory.normal.bpm);
    expect(Math.max(...safe)).toBeGreaterThan(Math.max(...normal));
    expect(safe[safe.length - 1] ?? 0).toBeGreaterThan(safe[0] ?? 0);
  });

  it("the Safe defeat is a gentle falling line", () => {
    const line = melody(TUNES.defeat.safe);
    for (let i = 1; i < line.length - 1; i++) expect(line[i] ?? 0).toBeLessThan(line[i - 1] ?? 0);
  });

  it("every note of every tune is actually scheduled", () => {
    const played = [
      ["victorySafe", TUNES.victory.safe],
      ["victoryNormal", TUNES.victory.normal],
      ["defeatSafe", TUNES.defeat.safe],
      ["defeatNormal", TUNES.defeat.normal],
    ] as const;
    for (const [name, tune] of played) {
      const voices = play(name).sources.filter((n) => n.kind === "oscillator").length;
      const notes = tune.notes.reduce((sum, note) => sum + note.midi.length, 0);
      expect(voices, name).toBeGreaterThanOrEqual(notes);
    }
  });
});

describe("noise", () => {
  it("makes white and brown noise once per context", () => {
    const ctx = FakeAudioContext.make();
    const first = noiseBuffersFor(ctx.asContext);
    expect(noiseBuffersFor(ctx.asContext)).toBe(first);
    expect(first.white.length).toBe(ctx.sampleRate * 2);
    const white = first.white.getChannelData(0);
    const brown = first.brown.getChannelData(0);
    const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    expect(rms(white)).toBeGreaterThan(0.4);
    expect(rms(brown)).toBeGreaterThan(0.02);
    expect(rms(brown)).toBeLessThan(rms(white));
    for (const data of [white, brown]) {
      expect(data.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.5)).toBe(true);
    }
  });
});
