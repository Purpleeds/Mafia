export interface BucketConfig {
  /** Burst size. */
  capacity: number;
  /** Sustained rate. */
  refillPerSecond: number;
}

export type RateCategory =
  | "connection"
  | "createRoom"
  | "joinRoom"
  | "resume"
  | "chat"
  | "gameAction"
  | "hostAction"
  | "timeSync"
  | "anyEvent";

export type RateLimitConfig = Record<RateCategory, BucketConfig>;

/**
 * Per-IP limits are sized for a whole party on one Wi-Fi network (or one
 * mobile carrier's shared address): 20 players each peeking, joining and
 * reconnecting must fit comfortably.
 */
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  /** New socket connections, per IP. */
  connection: { capacity: 60, refillPerSecond: 1 },
  /** Rooms created, per IP. */
  createRoom: { capacity: 5, refillPerSecond: 1 / 60 },
  /** room:peek and room:join, per IP (also slows down guessing room codes and passwords). */
  joinRoom: { capacity: 60, refillPerSecond: 1 },
  /** room:resume, per IP. Tokens can't be guessed, so this only stops floods. */
  resume: { capacity: 120, refillPerSecond: 2 },
  /** Chat messages, per player: bursts of 5, then one a second. */
  chat: { capacity: 5, refillPerSecond: 1 },
  /** Votes, night actions, role acknowledgements, per player. */
  gameAction: { capacity: 10, refillPerSecond: 2 },
  /** Settings, start, restart, kick, leave, profile changes, per player. */
  hostAction: { capacity: 10, refillPerSecond: 1 },
  timeSync: { capacity: 10, refillPerSecond: 0.5 },
  /** Every incoming event, per connection: a cap on raw flooding. */
  anyEvent: { capacity: 40, refillPerSecond: 10 },
};

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Token buckets keyed by owner (a socket id or an IP) and category. */
export class RateLimiter {
  private readonly owners = new Map<string, Map<RateCategory, Bucket>>();

  constructor(
    private readonly limits: RateLimitConfig = DEFAULT_RATE_LIMITS,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Takes one token; false if the owner is over the limit. */
  consume(owner: string, category: RateCategory): boolean {
    const config = this.limits[category];
    const now = this.clock();
    let buckets = this.owners.get(owner);
    if (!buckets) {
      buckets = new Map();
      this.owners.set(owner, buckets);
    }
    let bucket = buckets.get(category);
    if (!bucket) {
      bucket = { tokens: config.capacity, updatedAt: now };
      buckets.set(category, bucket);
    } else {
      const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(config.capacity, bucket.tokens + elapsed * config.refillPerSecond);
      bucket.updatedAt = now;
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  forget(owner: string): void {
    this.owners.delete(owner);
  }

  /** Drops owners that haven't been seen for a while (their buckets would be full again anyway). */
  prune(maxIdleMs: number): void {
    const now = this.clock();
    for (const [owner, buckets] of this.owners) {
      let newest = 0;
      for (const b of buckets.values()) newest = Math.max(newest, b.updatedAt);
      if (now - newest >= maxIdleMs) this.owners.delete(owner);
    }
  }

  get ownerCount(): number {
    return this.owners.size;
  }
}
