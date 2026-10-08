/** One pending callback per key (a room's phase timer). */
export interface Scheduler {
  /** Replaces any timer for `key` with one firing at epoch ms `at`. */
  set(key: string, at: number, fn: () => void): void;
  clear(key: string): void;
  clearAll(): void;
}

const MAX_DELAY = 2_147_483_647;

export class TimeoutScheduler implements Scheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly clock: () => number = Date.now) {}

  set(key: string, at: number, fn: () => void): void {
    this.clear(key);
    const delay = Math.min(Math.max(0, at - this.clock()), MAX_DELAY);
    const timer = setTimeout(() => {
      if (this.timers.get(key) === timer) this.timers.delete(key);
      fn();
    }, delay);
    timer.unref();
    this.timers.set(key, timer);
  }

  clear(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  clearAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  get size(): number {
    return this.timers.size;
  }
}
