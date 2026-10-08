/**
 * Rooms in memory, with a copy in Key Value (Redis) so they survive a restart
 * or redeploy of the web service.
 *
 * Memory stays the source of truth while the server runs: every read is from
 * memory, and every save also writes the room to Key Value in the background,
 * in order per room. If Key Value is slow, full or down, games carry on
 * unaffected and only the backup copy is missed (logged, at most once a minute).
 * At start-up `open()` loads every saved room back into memory; RoomService's
 * recover() then marks everyone as reconnecting and restarts the room timers.
 */
import type { Logger } from "../logger.js";
import type { KeyValue } from "./keyValue.js";
import { MemoryRoomStore, type RoomStore } from "./roomStore.js";
import type { Room } from "./types.js";

export const ROOM_KEY_PREFIX = "mafia:room:";
/** Longer than any room lives (games close after 3 idle hours); refreshed on every save. */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;

const keyFor = (code: string) => `${ROOM_KEY_PREFIX}${code}`;

function looksLikeRoom(value: unknown): value is Room {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "string" && typeof v.state === "object" && v.state !== null && typeof v.sessions === "object";
}

export class PersistentRoomStore implements RoomStore {
  private readonly memory = new MemoryRoomStore();
  /** Per room, the chain of pending writes, so they reach Key Value in order. */
  private readonly pending = new Map<string, Promise<void>>();
  private lastFailureLog = 0;
  /** Writes that failed since start-up (for tests and the logs). */
  failedWrites = 0;

  private constructor(
    private readonly kv: KeyValue,
    private readonly logger: Logger,
  ) {}

  /** Loads every saved room into memory. Broken entries are skipped (and deleted). */
  static async open(kv: KeyValue, logger: Logger): Promise<PersistentRoomStore> {
    const store = new PersistentRoomStore(kv, logger);
    let loaded = 0;
    for (const key of await kv.keys(ROOM_KEY_PREFIX)) {
      const raw = await kv.get(key);
      if (raw === null) continue;
      try {
        const room: unknown = JSON.parse(raw);
        if (!looksLikeRoom(room) || keyFor(room.code) !== key) throw new Error("not a room");
        await store.memory.save(room);
        loaded += 1;
      } catch {
        logger.warn("store.kv_skipped_entry", { key });
        await kv.del(key).catch(() => undefined);
      }
    }
    logger.info("store.ready", { kind: "keyvalue", rooms: loaded });
    return store;
  }

  get(code: string): Promise<Room | undefined> {
    return this.memory.get(code);
  }

  async create(room: Room): Promise<boolean> {
    const created = await this.memory.create(room);
    if (created) this.write(room.code, () => this.kv.set(keyFor(room.code), JSON.stringify(room), ROOM_TTL_SECONDS));
    return created;
  }

  async save(room: Room): Promise<void> {
    await this.memory.save(room);
    // Serialise now: the caller may change `room` after this returns.
    const json = JSON.stringify(room);
    this.write(room.code, () => this.kv.set(keyFor(room.code), json, ROOM_TTL_SECONDS));
  }

  async delete(code: string): Promise<void> {
    await this.memory.delete(code);
    this.write(code, () => this.kv.del(keyFor(code)));
  }

  codes(): Promise<string[]> {
    return this.memory.codes();
  }

  count(): Promise<number> {
    return this.memory.count();
  }

  /** Waits for every background write (shutdown and tests). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending.values()]);
  }

  private write(code: string, op: () => Promise<void>): void {
    const previous = this.pending.get(code) ?? Promise.resolve();
    const next = previous
      .then(op)
      .catch((err: unknown) => {
        this.failedWrites += 1;
        const now = Date.now();
        if (now - this.lastFailureLog >= 60_000) {
          this.lastFailureLog = now;
          this.logger.warn("store.kv_write_failed", {
            room: code,
            failed: this.failedWrites,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (this.pending.get(code) === next) this.pending.delete(code);
      });
    this.pending.set(code, next);
  }
}
