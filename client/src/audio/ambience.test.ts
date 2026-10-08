import { describe, expect, it, vi } from "vitest";
import { Ambience, crossfadeGains, type AmbienceStyle } from "./ambience";
import { FakeAudioContext, fakeOutput } from "./testing/fakeAudio";

/** A repeatable stream of "random" numbers, so a test always hears the same village. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sounds the scheduler makes, which are private: watch them without changing them. */
interface Phrases {
  bird(t: number, level: number): void;
  owl(t: number, level: number): void;
  chirp(gain: unknown, t: number, level: number): void;
}

function village(seed = 7) {
  const ctx = FakeAudioContext.make();
  const out = fakeOutput(ctx);
  const ambience = new Ambience(ctx.asContext, out.asNode, seeded(seed));
  const phrases = ambience as unknown as Phrases;
  const birds = vi.spyOn(phrases, "bird");
  const owls = vi.spyOn(phrases, "owl");
  const chirps = vi.spyOn(phrases, "chirp");
  return { ctx, ambience, birds, owls, chirps };
}

/** Starts the village at a time of day and lets `seconds` of it be scheduled. */
function listen(day: number, seconds: number, style: AmbienceStyle = "safe", seed = 7) {
  const v = village(seed);
  v.ambience.start();
  v.ambience.setMix(day, style, 0);
  v.ambience.scheduleUntil(seconds);
  return v;
}

describe("crossfadeGains", () => {
  it("is all night at 0 and all day at 1", () => {
    expect(crossfadeGains(0).day).toBeCloseTo(0, 9);
    expect(crossfadeGains(0).night).toBeCloseTo(1, 9);
    expect(crossfadeGains(1).day).toBeCloseTo(1, 9);
    expect(crossfadeGains(1).night).toBeCloseTo(0, 9);
  });

  it("keeps the loudness steady all the way across (equal power)", () => {
    for (let i = 0; i <= 20; i++) {
      const { day, night } = crossfadeGains(i / 20);
      expect(day * day + night * night).toBeCloseTo(1, 9);
    }
  });

  it("brings the day in as the night goes out, never dipping in the middle", () => {
    let previous = crossfadeGains(0);
    for (let i = 1; i <= 20; i++) {
      const next = crossfadeGains(i / 20);
      expect(next.day).toBeGreaterThan(previous.day);
      expect(next.night).toBeLessThan(previous.night);
      previous = next;
    }
    const middle = crossfadeGains(0.5);
    expect(middle.day).toBeGreaterThan(0.7);
    expect(middle.night).toBeGreaterThan(0.7);
  });

  it("clamps what is out of range", () => {
    expect(crossfadeGains(-2)).toEqual(crossfadeGains(0));
    expect(crossfadeGains(7)).toEqual(crossfadeGains(1));
  });
});

describe("the village's background", () => {
  it("makes nothing until it is started", () => {
    const v = village();
    v.ambience.scheduleUntil(120);
    expect(v.birds).not.toHaveBeenCalled();
    expect(v.owls).not.toHaveBeenCalled();
    expect(v.chirps).not.toHaveBeenCalled();
    expect(v.ctx.all("oscillator")).toHaveLength(0);
    expect(v.ctx.all("buffer")).toHaveLength(0);
  });

  it("starts its always-on layers once: three kinds of wind, and three crickets", () => {
    const v = village();
    v.ambience.start();
    const oscillators = v.ctx.all("oscillator").length;
    const winds = v.ctx.all("buffer");
    expect(winds).toHaveLength(3);
    expect(winds.every((w) => w.loop && w.startedAt !== null)).toBe(true);
    // 3 crickets + 3 slow wobbles for the wind
    expect(oscillators).toBe(6);
    v.ambience.start();
    expect(v.ctx.all("oscillator")).toHaveLength(oscillators);
    expect(v.ctx.all("buffer")).toHaveLength(3);
  });

  it("sings with birds by day, and nothing else", () => {
    const { birds, owls, chirps } = listen(1, 60);
    expect(birds.mock.calls.length).toBeGreaterThan(10);
    expect(owls).not.toHaveBeenCalled();
    expect(chirps).not.toHaveBeenCalled();
  });

  it("has crickets and an owl at night, and no birds", () => {
    const { birds, owls, chirps } = listen(0, 90);
    expect(birds).not.toHaveBeenCalled();
    expect(owls.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(chirps.mock.calls.length).toBeGreaterThan(100);
  });

  it("has a bit of everything at dusk and dawn", () => {
    for (const day of [0.3, 0.5, 0.7]) {
      const { birds, owls, chirps } = listen(day, 120);
      expect(birds.mock.calls.length, `birds at ${day}`).toBeGreaterThan(5);
      expect(chirps.mock.calls.length, `crickets at ${day}`).toBeGreaterThan(100);
      expect(owls.mock.calls.length, `owls at ${day}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("makes the birds quieter as the day fades out", () => {
    const noon = listen(1, 60);
    const evening = listen(0.3, 60);
    const loudest = (calls: unknown[][]) => Math.max(...calls.map((c) => Number(c[1])));
    expect(loudest(evening.birds.mock.calls)).toBeLessThan(loudest(noon.birds.mock.calls) * 0.8);
    expect(loudest(noon.birds.mock.calls)).toBeLessThanOrEqual(1);
  });

  it("is busier with birds in Safe Mode, and has more owls and wind in Normal Mode", () => {
    const safeDay = listen(1, 600, "safe");
    const normalDay = listen(1, 600, "normal");
    expect(safeDay.birds.mock.calls.length).toBeGreaterThan(normalDay.birds.mock.calls.length * 1.5);
    const safeNight = listen(0, 600, "safe");
    const normalNight = listen(0, 600, "normal");
    expect(normalNight.owls.mock.calls.length).toBeGreaterThan(safeNight.owls.mock.calls.length * 1.3);
  });

  it("never schedules the same stretch of time twice", () => {
    const { ambience, birds, owls, chirps } = listen(0.5, 30);
    const counts = [birds.mock.calls.length, owls.mock.calls.length, chirps.mock.calls.length];
    ambience.scheduleUntil(30);
    ambience.scheduleUntil(12);
    expect([birds.mock.calls.length, owls.mock.calls.length, chirps.mock.calls.length]).toEqual(counts);
    ambience.scheduleUntil(60);
    expect(birds.mock.calls.length).toBeGreaterThan(counts[0] ?? 0);
  });

  it("schedules phrases only ahead of the time it is given, and only within the horizon", () => {
    const { birds, owls } = listen(0.5, 45);
    for (const [t] of [...birds.mock.calls, ...owls.mock.calls]) {
      expect(Number(t)).toBeGreaterThanOrEqual(0);
      expect(Number(t)).toBeLessThan(45);
    }
  });

  it("plays every phrase it makes without upsetting the browser (hundreds of random songs)", () => {
    // The fake context throws on a non-finite value, a negative time or a ramp to zero.
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(() => listen(0.5, 400, seed % 2 === 0 ? "safe" : "normal", seed)).not.toThrow();
    }
    const v = listen(0.5, 400);
    const sources = v.ctx.nodes.filter((n) => n.startedAt !== null && n.kind === "oscillator");
    expect(sources.length).toBeGreaterThan(300);
    // every phrase ends: only the always-on layers are left running
    const endless = sources.filter((n) => n.stoppedAt === null);
    expect(endless).toHaveLength(6);
  });

  it("keeps its day amount, clamped, for the engine to report", () => {
    const { ambience } = village();
    ambience.setMix(0.4, "safe");
    expect(ambience.dayAmount).toBeCloseTo(0.4, 9);
    ambience.setMix(3, "normal");
    expect(ambience.dayAmount).toBe(1);
    ambience.setMix(-3, "normal");
    expect(ambience.dayAmount).toBe(0);
  });

  it("crossfades the day and night layers towards an equal-power mix", () => {
    const v = village();
    v.ambience.setMix(0.5, "safe", 3);
    // The first gain is the output the test made; the next two are the village's day and night layers.
    const [, dayLayer, nightLayer] = v.ctx.all("gain");
    const lastValue = (events: { value: number }[]) => events[events.length - 1]?.value ?? Number.NaN;
    const expected = crossfadeGains(0.5);
    expect(lastValue(dayLayer?.gain.events ?? [])).toBeCloseTo(expected.day, 9);
    expect(lastValue(nightLayer?.gain.events ?? [])).toBeCloseTo(expected.night, 9);
    expect(dayLayer?.gain.events.at(-1)?.method).toBe("setTargetAtTime");

    v.ambience.setMix(1, "safe", 0);
    expect(dayLayer?.gain.events.at(-1)).toMatchObject({ method: "setValueAtTime", value: 1 });
  });

  it("stops everything it started", () => {
    const v = village();
    v.ambience.start();
    v.ambience.stop();
    const sources = v.ctx.nodes.filter((n) => n.startedAt !== null);
    expect(sources.length).toBe(9);
    expect(sources.every((n) => n.stoppedAt !== null)).toBe(true);
    // it can begin again afterwards
    v.ambience.start();
    expect(v.ctx.all("buffer")).toHaveLength(6);
  });
});
