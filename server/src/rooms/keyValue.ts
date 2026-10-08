/**
 * The few Key Value (Redis-compatible) commands the room store needs, behind an
 * interface so tests can use an in-memory fake instead of a server.
 */
import { createClient } from "redis";
import type { Logger } from "../logger.js";

export interface KeyValue {
  get(key: string): Promise<string | null>;
  /** Sets the value and its time to live (seconds). */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Every key starting with `prefix`. */
  keys(prefix: string): Promise<string[]>;
  close(): Promise<void>;
}

/**
 * Connects to a Redis-compatible server (Render Key Value). Resolves once
 * connected, or rejects after `timeoutMs` so start-up never hangs on it.
 * After that the client reconnects by itself; commands sent while it is down
 * fail at once (no offline queue) instead of piling up in memory.
 */
export async function connectKeyValue(url: string, logger: Logger, timeoutMs = 5000): Promise<KeyValue> {
  let lastErrorLog = 0;
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: timeoutMs,
      reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 10_000),
    },
  });
  // Without a listener an error event would crash the process.
  client.on("error", (err: unknown) => {
    const now = Date.now();
    if (now - lastErrorLog < 60_000) return;
    lastErrorLog = now;
    logger.warn("store.kv_error", { error: err instanceof Error ? err.message : String(err) });
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } catch (err) {
    clearTimeout(timer);
    client.destroy();
    throw err;
  }
  clearTimeout(timer);

  return {
    get: (key) => client.get(key),
    set: async (key, value, ttlSeconds) => {
      await client.set(key, value, { EX: ttlSeconds });
    },
    del: async (key) => {
      await client.del(key);
    },
    keys: async (prefix) => {
      const found: string[] = [];
      for await (const batch of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) found.push(...batch);
      return found;
    },
    close: async () => {
      try {
        await client.close();
      } catch {
        client.destroy();
      }
    },
  };
}
