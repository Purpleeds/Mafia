import { describe, expect, it } from "vitest";
import type { Avatar, Role } from "@mafia/shared";
import { MemoryRoomStore } from "./roomStore.js";
import { makeService } from "./testing/fakes.js";

const AVATAR: Avatar = { color: "teal", icon: "fox" };
type Env = ReturnType<typeof makeService>;

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function code(result: { ok: boolean; error?: { code: string } }): string | undefined {
  return result.ok ? undefined : result.error?.code;
}

async function lobby(env: Env, n: number, password?: string) {
  const host = must(await env.service.createRoom("Host", AVATAR, { password }));
  const sessions = [host];
  for (let i = 2; i <= n; i++) {
    sessions.push(must(await env.service.joinRoom(host.roomCode, `Player ${i}`, AVATAR, password)));
  }
  return { roomCode: host.roomCode, sessions, ids: sessions.map((s) => s.playerId) };
}

async function started(env: Env, n = 7) {
  const room = await lobby(env, n);
  must(await env.service.act(room.roomCode, { type: "START_GAME", playerId: room.ids[0] ?? "" }));
  const stored = await env.store.get(room.roomCode);
  const roleOf = new Map<string, Role>((stored?.state.players ?? []).map((p) => [p.id, p.role ?? "villager"]));
  return { ...room, roleOf, withRole: (r: Role) => room.ids.filter((id) => roleOf.get(id) === r) };
}

describe("room codes", () => {
  it("lets the host pick a custom code (4–8 letters or numbers, any case)", async () => {
    const env = makeService();
    const host = must(await env.service.createRoom("Host", AVATAR, { customCode: "party-22" }));
    expect(host.roomCode).toBe("PARTY22");
    expect(env.logger.lines.some((l) => l.includes("room.created") && l.includes("customCode=true"))).toBe(true);
  });

  it("refuses a custom code that is taken, malformed, reserved or rude", async () => {
    const env = makeService();
    must(await env.service.createRoom("Host", AVATAR, { customCode: "PARTY" }));
    expect(code(await env.service.createRoom("B", AVATAR, { customCode: "party" }))).toBe("CODE_TAKEN");
    for (const bad of ["ABC", "TOOLONGCODE", "AB_CD", "HEALTHZ", "FCUK", "SH1T"]) {
      expect(code(await env.service.createRoom("B", AVATAR, { customCode: bad }))).toBe("CODE_INVALID");
    }
  });

  it("never hands out a rude generated code", async () => {
    const codes = ["FUCK", "SHAG", "NAZI", "GOOD"];
    const env = makeService({ generateCode: () => codes.shift() ?? "ZZZZ" });
    expect(must(await env.service.createRoom("Host", AVATAR)).roomCode).toBe("GOOD");
  });

  it("treats an empty custom code as none", async () => {
    const env = makeService({ generateCode: () => "QWER" });
    expect(must(await env.service.createRoom("Host", AVATAR, { customCode: "  " })).roomCode).toBe("QWER");
  });
});

describe("passwords", () => {
  it("are required to join a private room, and stored only as a hash", async () => {
    const env = makeService();
    const room = await lobby(env, 1, "hunter2");
    expect(code(await env.service.joinRoom(room.roomCode, "Bo", AVATAR))).toBe("PASSWORD_REQUIRED");
    expect(code(await env.service.joinRoom(room.roomCode, "Bo", AVATAR, "Hunter2"))).toBe("WRONG_PASSWORD");
    must(await env.service.joinRoom(room.roomCode, "Bo", AVATAR, "hunter2"));
    const stored = await env.store.get(room.roomCode);
    expect(JSON.stringify(stored)).not.toContain("hunter2");
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(env.logger.lines.join("\n")).not.toContain("hunter2");
  });

  it("aren't needed to resume your own seat", async () => {
    const env = makeService();
    const room = await lobby(env, 2, "hunter2");
    const guest = room.sessions[1];
    expect(must(await env.service.resumeSession(room.roomCode, guest?.sessionToken ?? "")).playerId).toBe(guest?.playerId);
  });

  it("can be set and removed by the host only, and everyone sees the lock", async () => {
    const env = makeService();
    const room = await lobby(env, 2);
    expect(code(await env.service.setPassword(room.roomCode, room.ids[1] ?? "", "secret"))).toBe("NOT_HOST");
    expect(code(await env.service.setPassword(room.roomCode, room.ids[0] ?? "", "ab"))).toBe("BAD_REQUEST");
    must(await env.service.setPassword(room.roomCode, room.ids[0] ?? "", "secret"));
    expect(env.broadcaster.lastState(room.ids[1] ?? "").room.hasPassword).toBe(true);
    expect(must(await env.service.peek(room.roomCode)).hasPassword).toBe(true);
    must(await env.service.setPassword(room.roomCode, room.ids[0] ?? "", null));
    expect(env.broadcaster.lastState(room.ids[1] ?? "").room.hasPassword).toBe(false);
    must(await env.service.joinRoom(room.roomCode, "Open", AVATAR));
  });

  it("are checked when creating", async () => {
    const env = makeService();
    expect(code(await env.service.createRoom("Host", AVATAR, { password: "x".repeat(33) }))).toBe("BAD_REQUEST");
  });
});

describe("peek", () => {
  it("describes a lobby", async () => {
    const env = makeService();
    const room = await lobby(env, 3);
    expect(must(await env.service.peek(room.roomCode))).toEqual({
      roomCode: room.roomCode,
      hasPassword: false,
      stage: "lobby",
      playerCount: 3,
      maxPlayers: 20,
      joinAs: "player",
      isFull: false,
    });
    expect(code(await env.service.peek("NOPE"))).toBe("ROOM_NOT_FOUND");
  });

  it("says late joiners will spectate", async () => {
    const env = makeService();
    const room = await started(env, 5);
    expect(must(await env.service.peek(room.roomCode))).toMatchObject({ stage: "in_game", joinAs: "spectator" });
  });
});

describe("late joiners", () => {
  it("join a running game as spectators and can resume as spectators", async () => {
    const env = makeService();
    const room = await started(env, 5);
    const late = must(await env.service.joinRoom(room.roomCode, "Late", AVATAR));
    expect(late.seat).toBe("spectator");
    expect(must(await env.service.resumeSession(room.roomCode, late.sessionToken)).seat).toBe("spectator");
    must(await env.service.sendSnapshot(room.roomCode, late.playerId));
    const view = env.broadcaster.lastState(late.playerId).view;
    expect(view.you?.isSpectator).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/"role":"/);
    // players see them in the spectator list
    expect(env.broadcaster.lastState(room.ids[0] ?? "").view.spectators.map((s) => s.name)).toEqual(["Late"]);
  });
});

describe("kicking", () => {
  it("tells the kicked player, revokes their session and stops their updates", async () => {
    const env = makeService();
    const room = await started(env, 6);
    const [host, victim] = room.ids as [string, string];
    must(await env.service.act(room.roomCode, { type: "KICK", playerId: host, targetId: victim }));
    const removed = env.broadcaster.to(victim).filter((s) => s.kind === "removed");
    expect(removed.map((s) => s.kind === "removed" && s.payload.reason)).toEqual(["kicked"]);
    expect(code(await env.service.resumeSession(room.roomCode, room.sessions[1]?.sessionToken ?? ""))).toBe(
      "SESSION_INVALID",
    );
    const sentAfter = env.broadcaster.sent.length;
    await env.fireTimer(room.roomCode);
    expect(env.broadcaster.sent.slice(sentAfter).some((s) => s.player === victim)).toBe(false);
    expect(env.logger.lines.some((l) => l.startsWith("INFO player.kicked"))).toBe(true);
  });

  it("removes a kicked lobby player completely", async () => {
    const env = makeService();
    const room = await lobby(env, 3);
    must(await env.service.act(room.roomCode, { type: "KICK", playerId: room.ids[0] ?? "", targetId: room.ids[2] ?? "" }));
    expect((await env.store.get(room.roomCode))?.state.players).toHaveLength(2);
    expect(env.broadcaster.to(room.ids[2] ?? "").some((s) => s.kind === "removed" && s.payload.reason === "kicked")).toBe(true);
  });
});

describe("reconnecting", () => {
  it("shows a dropped player as reconnecting, then offline after the grace period", async () => {
    const env = makeService();
    const room = await lobby(env, 2);
    const [host, guest] = room.ids as [string, string];
    must(await env.service.markReconnecting(room.roomCode, guest));
    const during = env.broadcaster.lastState(host).view.players[1];
    expect(during).toMatchObject({ connected: true, connection: "reconnecting" });
    must(await env.service.setConnected(room.roomCode, guest, false));
    expect(env.broadcaster.lastState(host).view.players[1]).toMatchObject({ connected: false, connection: "offline" });
  });

  it("clears the reconnecting status when they come back in time", async () => {
    const env = makeService();
    const room = await lobby(env, 2);
    const [host, guest] = room.ids as [string, string];
    must(await env.service.markReconnecting(room.roomCode, guest));
    must(await env.service.setConnected(room.roomCode, guest, true));
    expect(env.broadcaster.lastState(host).view.players[1]?.connection).toBe("online");
  });

  it("keeps the same role across a reconnect", async () => {
    const env = makeService();
    const room = await started(env, 5);
    const guest = room.sessions[2];
    if (!guest) throw new Error("no guest");
    must(await env.service.markReconnecting(room.roomCode, guest.playerId));
    must(await env.service.setConnected(room.roomCode, guest.playerId, false));
    const back = must(await env.service.resumeSession(room.roomCode, guest.sessionToken));
    must(await env.service.setConnected(room.roomCode, back.playerId, true));
    must(await env.service.sendSnapshot(room.roomCode, back.playerId));
    expect(env.broadcaster.lastState(back.playerId).view.you?.role).toBe(room.roleOf.get(guest.playerId));
  });
});

describe("chat privacy", () => {
  it("uses random message ids, so gaps can't reveal hidden chat", async () => {
    const env = makeService();
    const room = await lobby(env, 2);
    must(await env.service.sendChat(room.roomCode, room.ids[0] ?? "", "public", "one"));
    must(await env.service.sendChat(room.roomCode, room.ids[0] ?? "", "public", "two"));
    const ids = env.broadcaster.chatsTo(room.ids[1] ?? "").map((m) => m.id);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("doesn't give an eliminated Mafia member later Mafia chat through history", async () => {
    const env = makeService();
    const room = await started(env, 8);
    const [m1, m2] = room.withRole("mafia") as [string, string];
    await env.fireTimer(room.roomCode); // NIGHT
    must(await env.service.sendChat(room.roomCode, m2, "mafia", "before"));
    const stored = await env.store.get(room.roomCode);
    const dead = stored?.state.players.find((p) => p.id === m1);
    if (!stored || !dead) throw new Error("missing");
    dead.alive = false;
    await env.store.save(stored);
    must(await env.service.sendSnapshot(room.roomCode, m1));
    const history = env.broadcaster.to(m1).filter((s) => s.kind === "history").at(-1);
    expect(history?.kind === "history" && history.payload.messages.map((m) => m.text)).toEqual([]);
  });
});

describe("logging", () => {
  it("doesn't log role-revealing rejections next to a player id", async () => {
    const env = makeService();
    const room = await started(env, 7);
    await env.fireTimer(room.roomCode); // NIGHT
    const [villager] = room.withRole("villager") as [string];
    expect(code(await env.service.act(room.roomCode, { type: "NIGHT_ACTION", playerId: villager, targetId: villager }))).toBe(
      "NO_ABILITY",
    );
    expect(env.logger.lines.join("\n")).not.toContain("NO_ABILITY");
    expect(code(await env.service.act(room.roomCode, { type: "START_GAME", playerId: villager }))).toBe("WRONG_PHASE");
    const line = env.logger.lines.find((l) => l.includes("action.rejected"));
    expect(line).toBeDefined();
    expect(line).not.toContain(villager);
  });
});

describe("clean-up", () => {
  it("deletes a room 10 minutes after everyone has gone (by default)", async () => {
    const env = makeService({ lobbyDropMs: 60 * 60_000 });
    const room = await started(env, 5);
    for (const id of room.ids) must(await env.service.setConnected(room.roomCode, id, false));
    env.clock.now += 9 * 60_000;
    await env.service.sweep();
    expect(await env.store.get(room.roomCode)).toBeDefined();
    env.clock.now += 61_000;
    await env.service.sweep();
    expect(await env.store.get(room.roomCode)).toBeUndefined();
  });

  it("drops spectators who stay away", async () => {
    const env = makeService({ lobbyDropMs: 60_000 });
    const room = await started(env, 5);
    const late = must(await env.service.joinRoom(room.roomCode, "Late", AVATAR));
    must(await env.service.setConnected(room.roomCode, late.playerId, false));
    env.clock.now += 61_000;
    await env.service.sweep();
    expect((await env.store.get(room.roomCode))?.state.spectators).toEqual([]);
  });
});

describe("restart recovery", () => {
  it("marks everyone disconnected and re-arms phase timers for stored rooms", async () => {
    const store = new MemoryRoomStore();
    const first = makeService({ store });
    const room = await started(first, 5);
    const deadline = (await store.get(room.roomCode))?.state.phaseEndsAt;

    const second = makeService({ store }); // a fresh process, same store
    await second.service.recover();
    expect(second.scheduler.at(room.roomCode)).toBe(deadline);
    const after = await store.get(room.roomCode);
    expect(after?.state.players.every((p) => !p.connected)).toBe(true);
    expect(after?.emptySince).not.toBeNull();
  });
});
