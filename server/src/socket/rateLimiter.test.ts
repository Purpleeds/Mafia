import { describe, expect, it } from "vitest";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "./rateLimiter.js";

describe("RateLimiter", () => {
  it("allows a burst, then refills over time", () => {
    let now = 0;
    const limiter = new RateLimiter({ ...DEFAULT_RATE_LIMITS, chat: { capacity: 3, refillPerSecond: 1 } }, () => now);
    expect([1, 2, 3, 4].map(() => limiter.consume("s1", "chat"))).toEqual([true, true, true, false]);
    now += 999;
    expect(limiter.consume("s1", "chat")).toBe(false);
    now += 1;
    expect(limiter.consume("s1", "chat")).toBe(true);
    expect(limiter.consume("s1", "chat")).toBe(false);
  });

  it("never stores more than the burst size", () => {
    let now = 0;
    const limiter = new RateLimiter({ ...DEFAULT_RATE_LIMITS, chat: { capacity: 2, refillPerSecond: 1 } }, () => now);
    limiter.consume("s1", "chat");
    now += 60_000;
    expect([1, 2, 3].map(() => limiter.consume("s1", "chat"))).toEqual([true, true, false]);
  });

  it("keeps owners and categories separate", () => {
    const limiter = new RateLimiter({ ...DEFAULT_RATE_LIMITS, chat: { capacity: 1, refillPerSecond: 0 } }, () => 0);
    expect(limiter.consume("a", "chat")).toBe(true);
    expect(limiter.consume("a", "chat")).toBe(false);
    expect(limiter.consume("b", "chat")).toBe(true);
    expect(limiter.consume("a", "gameAction")).toBe(true);
  });

  it("lets a host configure a whole game and start it in one go", () => {
    // Six timers, the mode, a few switches, the role list, then Start: a dozen quick changes.
    const limiter = new RateLimiter(DEFAULT_RATE_LIMITS, () => 0);
    const burst = Array.from({ length: 15 }, () => limiter.consume("host", "hostAction"));
    expect(burst.every(Boolean)).toBe(true);
    // ...while a flood of them is still stopped.
    const flood = Array.from({ length: 40 }, () => limiter.consume("host", "hostAction"));
    expect(flood.some((ok) => !ok)).toBe(true);
  });

  it("forgets and prunes owners", () => {
    let now = 0;
    const limiter = new RateLimiter(DEFAULT_RATE_LIMITS, () => now);
    limiter.consume("a", "chat");
    limiter.consume("b", "chat");
    limiter.forget("a");
    expect(limiter.ownerCount).toBe(1);
    now += 5_000;
    limiter.consume("c", "chat");
    limiter.prune(4_000);
    expect(limiter.ownerCount).toBe(1); // only c is recent
  });
});
