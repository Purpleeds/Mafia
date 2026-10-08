import { randomInt } from "node:crypto";

/** Returns a number in [0, 1). */
export type Rng = () => number;

export const cryptoRng: Rng = () => randomInt(0x1_0000_0000) / 0x1_0000_0000;

/** Small seeded generator so tests are repeatable. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates; returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

export function pickRandom<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new Error("pickRandom: empty list");
  return items[Math.floor(rng() * items.length)] as T;
}
