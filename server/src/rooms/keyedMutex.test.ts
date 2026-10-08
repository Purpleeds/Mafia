import { describe, expect, it } from "vitest";
import { KeyedMutex } from "./keyedMutex.js";
import { normalizeRoomCode } from "@mafia/shared";
import { generateRoomCode, hashToken, newPlayerId, newSessionToken } from "./ids.js";

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
  it("makes 4-letter uppercase room codes without O, I or L (and no digits)", () => {
    for (let i = 0; i < 500; i++) expect(generateRoomCode()).toMatch(/^[A-HJKMNP-Z]{4}$/);
  });

  it("normalises typed room codes", () => {
    expect(normalizeRoomCode(" wx-yz")).toBe("WXYZ");
    expect(normalizeRoomCode("party2")).toBe("PARTY2");
    expect(normalizeRoomCode("ABC")).toBeNull();
    expect(normalizeRoomCode("ABCDEFGHI")).toBeNull();
  });

  it("makes player ids the engine accepts and unguessable tokens", () => {
    expect(newPlayerId()).toMatch(/^p[A-Za-z0-9_-]{12}$/);
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
