import { describe, expect, it } from "vitest";
import { KeyedMutex } from "./keyedMutex.js";
import { generateRoomCode, hashToken, newPlayerId, newSessionToken, normalizeRoomCode } from "./ids.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("KeyedMutex", () => {
  it("runs tasks for one key strictly in order", async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    await Promise.all([
      mutex.run("a", async () => {
        log.push("1 start");
        await sleep(20);
        log.push("1 end");
      }),
      mutex.run("a", async () => {
        log.push("2 start");
        log.push("2 end");
      }),
    ]);
    expect(log).toEqual(["1 start", "1 end", "2 start", "2 end"]);
    expect(mutex.size).toBe(0);
  });

  it("lets different keys run at the same time", async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    await Promise.all([
      mutex.run("a", async () => {
        await sleep(20);
        log.push("a");
      }),
      mutex.run("b", async () => {
        log.push("b");
      }),
    ]);
    expect(log).toEqual(["b", "a"]);
  });

  it("keeps going after a task fails", async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run("a", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(mutex.run("a", async () => 42)).resolves.toBe(42);
  });
});

describe("ids", () => {
  it("makes 4-letter room codes without I or O", () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode()).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });

  it("normalises room codes", () => {
    expect(normalizeRoomCode(" wxyz")).toBe("WXYZ");
    expect(normalizeRoomCode("WXY0")).toBeNull();
  });

  it("makes player ids the engine accepts and unguessable tokens", () => {
    expect(newPlayerId()).toMatch(/^p[A-Za-z0-9_-]{12}$/);
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
