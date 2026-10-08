import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@mafia/shared";

type StorageStub = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; data: Map<string, string> };

function stub(): StorageStub {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const session: SessionInfo = { roomCode: "ABCD", playerId: "p1", sessionToken: "t".repeat(24), seat: "player" };

let local: StorageStub;
let tab: StorageStub;

beforeEach(() => {
  vi.resetModules();
  local = stub();
  tab = stub();
  vi.stubGlobal("window", { localStorage: local, sessionStorage: tab });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("where a seat is remembered", () => {
  it("is the browser's localStorage normally, so closing and reopening the tab resumes it", async () => {
    const storage = await import("./storage");
    storage.saveSession(session);
    expect(local.data.size).toBeGreaterThan(0);
    expect(tab.data.size).toBe(0);
    expect(storage.loadSession("ABCD")).toEqual(session);
  });

  it("is each tab's own sessionStorage in development, so tabs can be different players", async () => {
    const storage = await import("./storage");
    storage.setPerTabStorage(true);
    storage.saveSession(session);
    storage.saveProfile({ name: "Tab One" });
    expect(local.data.size).toBe(0);
    expect(tab.data.size).toBeGreaterThan(0);
    expect(storage.loadSession("ABCD")).toEqual(session);
    expect(storage.loadProfile().name).toBe("Tab One");

    // a second tab of the same browser: shares localStorage, has its own sessionStorage
    const other = stub();
    vi.stubGlobal("window", { localStorage: local, sessionStorage: other });
    expect(storage.loadSession("ABCD")).toBeNull();
    expect(storage.loadProfile().name).toBeUndefined();
    expect(storage.loadActiveRoom()).toBeNull();
  });

  it("forgets a seat from the same place it was saved", async () => {
    const storage = await import("./storage");
    storage.setPerTabStorage(true);
    storage.saveSession(session);
    storage.forgetSession("ABCD");
    expect(storage.loadSession("ABCD")).toBeNull();
    expect(tab.data.size).toBe(0);
  });
});

describe("asking the server whether this is a development run", () => {
  const respond = (body: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));

  it("turns dev mode (and per-tab seats) on when the server says so", async () => {
    respond({ dev: true });
    const { loadDevConfig, isDevMode } = await import("./dev");
    const storage = await import("./storage");
    expect(await loadDevConfig()).toBe(true);
    expect(isDevMode()).toBe(true);
    storage.saveSession(session);
    expect(tab.data.size).toBeGreaterThan(0);
  });

  it("stays off for a production server, a missing route, a page that isn't JSON, or no answer at all", async () => {
    for (const make of [
      () => respond({ dev: false }),
      () => respond({}, false),
      () => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new Error("<html>"); } }))),
      () => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); })),
      () => respond({ dev: "yes" }),
    ]) {
      vi.resetModules();
      make();
      const { loadDevConfig, isDevMode } = await import("./dev");
      const storage = await import("./storage");
      expect(await loadDevConfig()).toBe(false);
      expect(isDevMode()).toBe(false);
      storage.saveSession(session);
      expect(local.data.size).toBeGreaterThan(0);
      local.data.clear();
    }
  });
});
