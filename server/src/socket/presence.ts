/**
 * Which socket currently speaks for each player (one at a time), plus a short
 * grace period after a socket drops so a page refresh doesn't show the player
 * as disconnected. Process-local: with several server instances this would
 * move to the shared store along with the rooms.
 */
export class Presence {
  private readonly active = new Map<string, string>();
  private readonly grace = new Map<string, NodeJS.Timeout>();

  private key(roomCode: string, playerId: string): string {
    return `${roomCode}:${playerId}`;
  }

  /** Makes `socketId` the player's socket. Returns the socket it replaced, if any. */
  claim(roomCode: string, playerId: string, socketId: string): string | undefined {
    const key = this.key(roomCode, playerId);
    this.cancelGrace(key);
    const previous = this.active.get(key);
    this.active.set(key, socketId);
    return previous !== socketId ? previous : undefined;
  }

  /** Forgets the socket if it is still the player's socket. True if it was. */
  release(roomCode: string, playerId: string, socketId: string): boolean {
    const key = this.key(roomCode, playerId);
    if (this.active.get(key) !== socketId) return false;
    this.active.delete(key);
    return true;
  }

  isActive(roomCode: string, playerId: string, socketId: string): boolean {
    return this.active.get(this.key(roomCode, playerId)) === socketId;
  }

  /** Runs `fn` after `ms` unless the player reconnects first. */
  startGrace(roomCode: string, playerId: string, ms: number, fn: () => void): void {
    const key = this.key(roomCode, playerId);
    this.cancelGrace(key);
    const timer = setTimeout(() => {
      this.grace.delete(key);
      fn();
    }, ms);
    timer.unref();
    this.grace.set(key, timer);
  }

  private cancelGrace(key: string): void {
    const timer = this.grace.get(key);
    if (timer) clearTimeout(timer);
    this.grace.delete(key);
  }

  clear(): void {
    for (const timer of this.grace.values()) clearTimeout(timer);
    this.grace.clear();
    this.active.clear();
  }
}
