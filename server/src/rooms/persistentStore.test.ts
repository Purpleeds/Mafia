import type { Avatar } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { createMemoryLogger } from "../logger.js";
import type { KeyValue } from "./keyValue.js";
import { PersistentRoomStore, ROOM_KEY_PREFIX, ROOM_TTL_SECONDS } from "./persistentStore.js";
import { makeService } from "./testing/fakes.js";

const AVATAR: Avatar = { color: "teal", seed: "fox" };

/** An in-memory stand-in for Render Key Value that can be told to fail or be slow. */
class FakeKeyValue implements KeyValue {
  readonly data = new Map<string, { value: string; ttl: number }>();
  readonly log: string[] = [];
  failing = false;
  delayMs = 0;
  async get(key: string) {
    return this.data.get(key)?.value ?? null;
  }
  async set(key: string, value: string, ttl: number) {
    if (this.delayMs) await new Promise((r) => setTimeout(r, Math.random() * this.delayMs));
    if (this.failing) throw new Error("connection is closed");
    this.data.set(key, { value, ttl });
    this.log.push(`set ${key}`);
  }
  async del(key: string) {
    if (this.failing) throw new Error("connection is closed");
    this.data.delete(key);
    this.log.push(`del ${key}`);
  }
  async keys(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
  async close() {}
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("the Key Value room store", () => {
  it("copies every saved room to Key Value, with a time to live", async () => {
    const kv = new FakeKeyValue();
    const store = await PersistentRoomStore.open(kv, createMemoryLogger());
    const env = makeService({ store });
    const host = must(await env.service.createRoom("Host", AVATAR));
    await store.flush();
    const saved = kv.data.get(`${ROOM_KEY_PREFIX}${host.roomCode}`);
    expect(saved?.ttl).toBe(ROOM_TTL_SECONDS);
    expect(JSON.parse(saved?.value ?? "{}").state.players[0].name).toBe("Host");
  });

  it("writes each room's saves in order, even when Key Value answers out of order", async () => {
    const kv = new FakeKeyValue();
    kv.delayMs = 15;
    const store = await PersistentRoomStore.open(kv, createMemoryLogger());
    const env = makeService({ store });
    const host = must(await env.service.createRoom("Host", AVATAR));
    for (let i = 2; i <= 6; i++) must(await env.service.joinRoom(host.roomCode, `Player ${i}`, AVATAR));
    await store.flush();
    const saved = JSON.parse(kv.data.get(`${ROOM_KEY_PREFIX}${host.roomCode}`)?.value ?? "{}");
    expect(saved.state.players).toHaveLength(6);
  });

  it("removes a closed room from Key Value too", async () => {
    const kv = new FakeKeyValue();
    const store = await PersistentRoomStore.open(kv, createMemoryLogger());
    const env = makeService({ store });
    const host = must(await env.service.createRoom("Host", AVATAR));
    must(await env.service.leave(host.roomCode, host.playerId)); // the last person leaves: the room closes
    await store.flush();
    expect(await store.get(host.roomCode)).toBeUndefined();
    expect(kv.data.has(`${ROOM_KEY_PREFIX}${host.roomCode}`)).toBe(false);
  });

  it("keeps games running when Key Value is down, and says so in the log once", async () => {
    const kv = new FakeKeyValue();
    const logger = createMemoryLogger();
    const store = await PersistentRoomStore.open(kv, logger);
    const env = makeService({ store, logger });
    kv.failing = true;
    const host = must(await env.service.createRoom("Host", AVATAR));
    for (let i = 2; i <= 5; i++) must(await env.service.joinRoom(host.roomCode, `Player ${i}`, AVATAR));
    must(await env.service.act(host.roomCode, { type: "START_GAME", playerId: host.playerId }));
    await store.flush();
    expect((await store.get(host.roomCode))?.state.phase).toBe("ROLE_REVEAL");
    expect(store.failedWrites).toBeGreaterThan(3);
    expect(logger.lines.filter((l) => l.includes("store.kv_write_failed"))).toHaveLength(1);
    // back up: the next save goes through
    kv.failing = false;
    must(await env.service.act(host.roomCode, { type: "ACK_ROLE", playerId: host.playerId }));
    await store.flush();
    expect(kv.data.has(`${ROOM_KEY_PREFIX}${host.roomCode}`)).toBe(true);
  });

  it("skips (and removes) anything in Key Value that isn't a room", async () => {
    const kv = new FakeKeyValue();
    kv.data.set(`${ROOM_KEY_PREFIX}BAD1`, { value: "not json", ttl: 1 });
    kv.data.set(`${ROOM_KEY_PREFIX}BAD2`, { value: '{"code":"ZZZZ","state":{},"sessions":{}}', ttl: 1 });
    kv.data.set("someone-else:key", { value: "keep me", ttl: 1 });
    const logger = createMemoryLogger();
    const store = await PersistentRoomStore.open(kv, logger);
    expect(await store.count()).toBe(0);
    expect(kv.data.has(`${ROOM_KEY_PREFIX}BAD1`)).toBe(false);
    expect(kv.data.has(`${ROOM_KEY_PREFIX}BAD2`)).toBe(false);
    expect(kv.data.has("someone-else:key")).toBe(true);
    expect(logger.lines.filter((l) => l.includes("store.kv_skipped_entry"))).toHaveLength(2);
  });
});

describe("a restart with Key Value", () => {
  it("keeps the room, the roles, the seats and the timer, and the game goes on", async () => {
    const kv = new FakeKeyValue();
    // ---- before the restart: a game at night
    const storeA = await PersistentRoomStore.open(kv, createMemoryLogger());
    const a = makeService({ store: storeA });
    const host = must(await a.service.createRoom("Host", AVATAR));
    const code = host.roomCode;
    const seats = [host];
    for (let i = 2; i <= 6; i++) seats.push(must(await a.service.joinRoom(code, `Player ${i}`, AVATAR)));
    must(await a.service.act(code, { type: "START_GAME", playerId: host.playerId }));
    await a.fireTimer(code); // NIGHT
    const before = (await storeA.get(code))?.state;
    expect(before?.phase).toBe("NIGHT");
    await storeA.flush();

    // ---- the server restarts: new process, new memory, same Key Value
    const logger = createMemoryLogger();
    const storeB = await PersistentRoomStore.open(kv, logger);
    const b = makeService({ store: storeB, logger });
    b.clock.now = a.clock.now + 30_000;
    await b.service.recover();
    expect(logger.lines.some((l) => l.includes("rooms.recovered") && l.includes("rooms=1"))).toBe(true);

    const after = (await storeB.get(code))?.state;
    expect(after?.phase).toBe("NIGHT");
    expect(after?.players.map((p) => [p.id, p.role])).toEqual(before?.players.map((p) => [p.id, p.role]));
    // nobody's socket survived: everyone gets the reconnect grace, so they still count as present
    expect(after?.players.every((p) => p.connected)).toBe(true);
    expect(Object.keys((await storeB.get(code))?.reconnecting ?? {})).toHaveLength(6);
    // the phase timer runs again
    expect(b.scheduler.at(code)).toBeDefined();

    // everyone's saved session still works, and they're back in their seat
    for (const seat of seats) {
      const resumed = must(await b.service.resumeSession(code, seat.sessionToken));
      expect(resumed.playerId).toBe(seat.playerId);
      must(await b.service.setConnected(code, seat.playerId, true));
    }
    expect((await storeB.get(code))?.state.players.every((p) => p.connected)).toBe(true);

    // and the night still ends on its timer
    await b.fireTimer(code);
    expect((await storeB.get(code))?.state.phase).toBe("NIGHT_RESULTS");
  });

  it("doesn't end a night early just because the server restarted (nobody has reconnected yet)", async () => {
    const kv = new FakeKeyValue();
    const storeA = await PersistentRoomStore.open(kv, createMemoryLogger());
    const a = makeService({ store: storeA });
    const host = must(await a.service.createRoom("Host", AVATAR));
    const code = host.roomCode;
    for (let i = 2; i <= 6; i++) must(await a.service.joinRoom(code, `Player ${i}`, AVATAR));
    must(await a.service.act(code, { type: "START_GAME", playerId: host.playerId }));
    await a.fireTimer(code); // NIGHT, nobody has acted
    await storeA.flush();

    const storeB = await PersistentRoomStore.open(kv, createMemoryLogger());
    const b = makeService({ store: storeB });
    b.clock.now = a.clock.now + 2_000;
    await b.service.recover();
    // the old code marked everyone disconnected here, which ended the night at once with nobody acting
    const state = (await storeB.get(code))?.state;
    expect(state?.phase).toBe("NIGHT");
    expect(state?.history).toHaveLength(0);
  });

  it("closes a recovered room nobody comes back to, like any empty room", async () => {
    const kv = new FakeKeyValue();
    const storeA = await PersistentRoomStore.open(kv, createMemoryLogger());
    const a = makeService({ store: storeA });
    const host = must(await a.service.createRoom("Host", AVATAR));
    await storeA.flush();
    const storeB = await PersistentRoomStore.open(kv, createMemoryLogger());
    const b = makeService({ store: storeB });
    await b.service.recover();
    b.clock.now += 11 * 60_000;
    await b.service.sweep();
    await storeB.flush();
    expect(await storeB.get(host.roomCode)).toBeUndefined();
    expect(kv.data.size).toBe(0);
  });
});
