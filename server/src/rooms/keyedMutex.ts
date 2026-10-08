/**
 * Runs async tasks one at a time per key (a room code), in arrival order, so
 * two events for the same room can never interleave between "load" and "save".
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => done);
    this.tails.set(key, tail);
    return previous.then(task).finally(() => {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
  }

  /** Number of keys with queued or running work (for tests). */
  get size(): number {
    return this.tails.size;
  }
}
