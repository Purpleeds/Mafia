import { describe, expect, it } from "vitest";
import type { Avatar, Role } from "@mafia/shared";
import { makeService } from "./testing/fakes.js";

const AVATAR: Avatar = { color: "teal", seed: "fox" };

type Env = ReturnType<typeof makeService>;

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** A room with `n` players; returns their ids in join order (host first). */
async function roomWith(env: Env, n: number) {
  const host = must(await env.service.createRoom("Host", AVATAR));
  const sessions = [host];
  for (let i = 2; i <= n; i++) sessions.push(must(await env.service.joinRoom(host.roomCode, `Player ${i}`, AVATAR)));
  return { code: host.roomCode, ids: sessions.map((s) => s.playerId), sessions };
}

async function startedRoom(env: Env, n = 8, settings: Record<string, unknown> = {}) {
  const room = await roomWith(env, n);
  const [host] = room.ids as [string];
  if (Object.keys(settings).length > 0) {
    must(await env.service.act(room.code, { type: "UPDATE_SETTINGS", playerId: host, settings }));
  }
  must(await env.service.act(room.code, { type: "START_GAME", playerId: host }));
  const stored = await env.store.get(room.code);
  const roleOf = new Map<string, Role>();
  for (const p of stored?.state.players ?? []) if (p.role) roleOf.set(p.id, p.role);
  const withRole = (role: Role) => room.ids.filter((id) => roleOf.get(id) === role);
  return { ...room, roleOf, withRole };
}

describe("rooms", () => {
  it("creates a room with a 4-letter code and the creator as host", async () => {
    const env = makeService();
    const host = must(await env.service.createRoom("  Ana ", AVATAR));
    expect(host.roomCode).toMatch(/^[A-HJKMNP-Z]{4}$/);
    expect(host.seat).toBe("player");
    const room = await env.store.get(host.roomCode);
    expect(room?.state.hostId).toBe(host.playerId);
    expect(room?.state.players[0]?.name).toBe("Ana");
    // only a hash of the session token is stored
    expect(JSON.stringify(room)).not.toContain(host.sessionToken);
    expect(env.logger.lines.some((l) => l.startsWith("INFO room.created") && l.includes(host.roomCode))).toBe(true);
  });

  it("rejects bad names and unknown rooms", async () => {
    const env = makeService();
    expect((await env.service.createRoom("   ", AVATAR)).ok).toBe(false);
    const result = await env.service.joinRoom("ZZZZ", "Bo", AVATAR);
    expect(!result.ok && result.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("retries when a room code is taken", async () => {
    const codes = ["AAAA", "AAAA", "BBBB"];
    const env = makeService({ generateCode: () => codes.shift() ?? "CCCC" });
    expect(must(await env.service.createRoom("A", AVATAR)).roomCode).toBe("AAAA");
    expect(must(await env.service.createRoom("B", AVATAR)).roomCode).toBe("BBBB");
  });

  it("refuses new rooms when full", async () => {
    const env = makeService({ maxRooms: 1 });
    must(await env.service.createRoom("A", AVATAR));
    const second = await env.service.createRoom("B", AVATAR);
    expect(!second.ok && second.error.code).toBe("SERVER_BUSY");
  });

  it("sends everyone the new lobby when someone joins", async () => {
    const env = makeService();
    const { ids } = await roomWith(env, 3);
    expect(env.broadcaster.lastState(ids[0] ?? "").view.players).toHaveLength(3);
    expect(env.broadcaster.lastState(ids[1] ?? "").view.players).toHaveLength(3);
  });

  it("serialises simultaneous joins so nobody is lost", async () => {
    const env = makeService();
    const host = must(await env.service.createRoom("Host", AVATAR));
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => env.service.joinRoom(host.roomCode, `P${i}`, AVATAR)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await env.store.get(host.roomCode))?.state.players).toHaveLength(13);
  });

  it("resumes a session only with the right token", async () => {
    const env = makeService();
    const { code, sessions } = await roomWith(env, 2);
    const guest = sessions[1];
    if (!guest) throw new Error("no guest");
    expect(must(await env.service.resumeSession(code, guest.sessionToken)).playerId).toBe(guest.playerId);
    const wrong = await env.service.resumeSession(code, "x".repeat(32));
    expect(!wrong.ok && wrong.error.code).toBe("SESSION_INVALID");
    const other = must(await env.service.createRoom("Other", AVATAR));
    const crossRoom = await env.service.resumeSession(other.roomCode, guest.sessionToken);
    expect(crossRoom.ok).toBe(false);
  });

  it("removes a player who leaves the lobby and invalidates their session", async () => {
    const env = makeService();
    const { code, ids, sessions } = await roomWith(env, 3);
    must(await env.service.leave(code, ids[1] ?? ""));
    const removed = env.broadcaster.to(ids[1] ?? "").filter((s) => s.kind === "removed");
    expect(removed.map((s) => s.kind === "removed" && s.payload.reason)).toEqual(["left"]);
    expect((await env.service.resumeSession(code, sessions[1]?.sessionToken ?? "")).ok).toBe(false);
    expect(env.broadcaster.lastState(ids[0] ?? "").view.players).toHaveLength(2);
  });

  it("closes the room when the last player leaves the lobby", async () => {
    const env = makeService();
    const host = must(await env.service.createRoom("Solo", AVATAR));
    must(await env.service.leave(host.roomCode, host.playerId));
    expect(await env.store.get(host.roomCode)).toBeUndefined();
    expect(env.logger.lines.some((l) => l.startsWith("INFO room.closed"))).toBe(true);
  });
});

describe("personalised views", () => {
  it("never sends a player anyone else's role", async () => {
    const env = makeService();
    const room = await startedRoom(env, 8, { revealRoleOnDeath: false });
    for (const sent of env.broadcaster.sent) {
      const own = room.roleOf.get(sent.player);
      const roles = [...JSON.stringify(sent.payload).matchAll(/"role":"(\w+)"/g)].map((m) => m[1]);
      for (const role of roles) expect(role).toBe(own);
    }
  });

  it("tells the Mafia who their teammates are, and nobody else", async () => {
    const env = makeService();
    const room = await startedRoom(env, 8);
    const [m1, m2] = room.withRole("mafia");
    expect(env.broadcaster.lastState(m1 ?? "").view.you?.teammateIds).toEqual([m2]);
    for (const id of room.ids.filter((id) => room.roleOf.get(id) !== "mafia")) {
      expect(env.broadcaster.lastState(id).view.you?.teammateIds).toEqual([]);
    }
  });

  it("shows investigation results only to the Detective", async () => {
    const env = makeService();
    const room = await startedRoom(env, 8);
    const [detective] = room.withRole("detective");
    const [mafia] = room.withRole("mafia");
    if (!detective || !mafia) throw new Error("roles missing");
    await env.fireTimer(room.code); // -> NIGHT
    must(await env.service.act(room.code, { type: "NIGHT_ACTION", playerId: detective, targetId: mafia }));
    await env.fireTimer(room.code); // -> NIGHT_RESULTS
    expect(env.broadcaster.lastState(detective).view.you?.investigations).toEqual([
      { round: 1, targetId: mafia, isMafia: true },
    ]);
    for (const id of room.ids.filter((id) => id !== detective)) {
      expect(env.broadcaster.lastState(id).view.you?.investigations).toEqual([]);
    }
  });

  it("stamps every update with the server clock and a per-player version counting only their updates", async () => {
    const env = makeService();
    const room = await startedRoom(env, 5);
    for (const id of room.ids) {
      const versions = env.broadcaster.sent
        .filter((s) => s.kind === "state" && s.player === id)
        .map((s) => (s.kind === "state" ? s.payload.version : 0));
      expect(versions).toEqual(versions.map((_, i) => i + 1));
    }
    const last = env.broadcaster.lastState(room.ids[0] ?? "");
    expect(last.serverNow).toBe(env.clock.now);
    expect((last.view.phaseEndsAt ?? 0) - last.serverNow).toBe(10_000); // role reveal
    expect(last.room).toEqual({ code: room.code, hasPassword: false });
  });

  it("sends nothing to players whose view didn't change (no night-activity side channel)", async () => {
    const env = makeService();
    const room = await startedRoom(env, 8);
    await env.fireTimer(room.code); // NIGHT
    const [m1, m2] = room.withRole("mafia") as [string, string];
    const [doctor] = room.withRole("doctor") as [string];
    const villagers = room.withRole("villager");
    const before = env.broadcaster.sent.length;
    must(await env.service.act(room.code, { type: "NIGHT_ACTION", playerId: m1, targetId: villagers[0] ?? "" }));
    must(await env.service.act(room.code, { type: "NIGHT_ACTION", playerId: m1, targetId: villagers[1] ?? "" }));
    must(await env.service.act(room.code, { type: "NIGHT_ACTION", playerId: doctor, targetId: doctor }));
    const recipients = new Set(env.broadcaster.sent.slice(before).map((s) => s.player));
    expect([...recipients].sort()).toEqual([m1, m2, doctor].sort());
    for (const v of villagers) expect(recipients.has(v)).toBe(false);
  });
});

describe("timers", () => {
  it("arms a timer for each phase deadline and advances when it fires", async () => {
    const env = makeService();
    const room = await startedRoom(env, 5);
    const stored = await env.store.get(room.code);
    expect(env.scheduler.at(room.code)).toBe(stored?.state.phaseEndsAt);
    await env.fireTimer(room.code);
    const after = await env.store.get(room.code);
    expect(after?.state.phase).toBe("NIGHT");
    expect(env.scheduler.at(room.code)).toBe(after?.state.phaseEndsAt);
    expect(env.broadcaster.lastState(room.ids[1] ?? "").view.phase).toBe("NIGHT");
  });

  it("waits again if the timer fires a little early", async () => {
    const env = makeService();
    const room = await startedRoom(env, 5);
    const deadline = env.scheduler.at(room.code) ?? 0;
    env.clock.now = deadline - 5;
    const sentBefore = env.broadcaster.sent.length;
    await env.service.handleTimer(room.code);
    expect((await env.store.get(room.code))?.state.phase).toBe("ROLE_REVEAL");
    expect(env.scheduler.at(room.code)).toBe(deadline);
    expect(env.broadcaster.sent.length).toBe(sentBefore); // no pointless re-broadcast
  });

  it("stops the timer when the game ends", async () => {
    const env = makeService();
    const room = await startedRoom(env, 5);
    const [mafia] = room.withRole("mafia");
    await env.fireTimer(room.code); // NIGHT
    await env.fireTimer(room.code); // NIGHT_RESULTS
    await env.fireTimer(room.code); // DAY_DISCUSSION
    await env.fireTimer(room.code); // VOTING
    for (const id of room.ids.filter((id) => id !== mafia)) {
      must(await env.service.act(room.code, { type: "CAST_VOTE", playerId: id, targetId: mafia ?? "" }));
    }
    await env.fireTimer(room.code); // VOTE_RESULTS (mafia didn't vote, so the timer closes the vote)
    await env.fireTimer(room.code); // GAME_OVER
    expect((await env.store.get(room.code))?.state.winner).toBe("town");
    expect(env.scheduler.at(room.code)).toBeUndefined();
    expect(env.logger.lines.some((l) => l === `INFO game.over room=${room.code} winner=town rounds=1`)).toBe(true);
  });

  it("ignores timers for rooms that no longer exist", async () => {
    const env = makeService();
    await expect(env.service.handleTimer("NOPE")).resolves.toBeUndefined();
  });
});

describe("chat", () => {
  it("delivers Mafia chat only to the Mafia, at night", async () => {
    const env = makeService();
    const room = await startedRoom(env, 8);
    const [m1, m2] = room.withRole("mafia") as [string, string];
    const [villager] = room.withRole("villager") as [string];
    const early = await env.service.sendChat(room.code, m1, "too early"); // still ROLE_REVEAL
    expect(!early.ok && early.error.code).toBe("CHAT_NOT_ALLOWED");
    await env.fireTimer(room.code); // NIGHT
    must(await env.service.sendChat(room.code, m1, "Take Player 3"));
    expect(env.broadcaster.chatsTo(m2).map((m) => m.text)).toContain("Take Player 3");
    expect(env.broadcaster.chatsTo(villager)).toEqual([]);
    const blocked = await env.service.sendChat(room.code, villager, "let me in");
    expect(!blocked.ok && blocked.error.code).toBe("CHAT_NOT_ALLOWED");
    const silent = await env.service.sendChat(room.code, villager, "anyone?");
    expect(!silent.ok && silent.error.code).toBe("CHAT_NOT_ALLOWED");
  });

  it("sends chat history filtered to what the player may see", async () => {
    const env = makeService();
    const room = await startedRoom(env, 8);
    const [m1, m2] = room.withRole("mafia") as [string, string];
    const [villager] = room.withRole("villager") as [string];
    await env.fireTimer(room.code); // NIGHT
    must(await env.service.sendChat(room.code, m1, "secret plan"));
    must(await env.service.sendSnapshot(room.code, villager));
    must(await env.service.sendSnapshot(room.code, m2));
    const historyOf = (id: string) =>
      env.broadcaster.to(id).filter((s) => s.kind === "history").map((s) => (s.kind === "history" ? s.payload.messages : []));
    expect(historyOf(villager).at(-1)).toEqual([]);
    expect((historyOf(m2).at(-1) ?? []).map((m) => m.text)).toEqual(["secret plan"]);
  });

  it("cleans and bounds message text", async () => {
    const env = makeService();
    const { code, ids } = await roomWith(env, 2);
    must(await env.service.sendChat(code, ids[0] ?? "", "  hi\u0000 \n there  "));
    expect(env.broadcaster.chatsTo(ids[1] ?? "").at(-1)?.text).toBe("hi there");
    const empty = await env.service.sendChat(code, ids[0] ?? "", "   ");
    expect(!empty.ok && empty.error.code).toBe("BAD_REQUEST");
    const long = await env.service.sendChat(code, ids[0] ?? "", "x".repeat(301));
    expect(long.ok).toBe(false);
  });

  it("never logs chat text, roles or tokens", async () => {
    const env = makeService();
    const room = await startedRoom(env, 8);
    const [m1] = room.withRole("mafia") as [string];
    await env.fireTimer(room.code);
    must(await env.service.sendChat(room.code, m1, "zebra-plan"));
    const all = env.logger.lines.join("\n");
    expect(all).not.toContain("zebra-plan");
    for (const role of ["villager", "detective", "doctor"]) expect(all).not.toContain(role);
    for (const s of room.sessions) expect(all).not.toContain(s.sessionToken);
  });
});

describe("chat routing and reactions", () => {
  /** A started 8-player room moved on to the day discussion, with one villager eliminated. */
  async function dayRoom() {
    const env = makeService();
    const room = await startedRoom(env, 8);
    const [mafia] = room.withRole("mafia") as [string];
    const [dead, living] = room.withRole("villager") as [string, string];
    await env.fireTimer(room.code); // NIGHT
    await env.fireTimer(room.code); // NIGHT_RESULTS
    await env.fireTimer(room.code); // DAY_DISCUSSION
    const stored = await env.store.get(room.code);
    expect(stored?.state.phase).toBe("DAY_DISCUSSION");
    const victim = stored?.state.players.find((p) => p.id === dead);
    if (!victim) throw new Error("no victim");
    victim.alive = false;
    await env.store.save(stored as NonNullable<typeof stored>);
    return { env, room, mafia, dead, living };
  }

  it("sends a living player's day message to the public channel, whatever role they have", async () => {
    const { env, room, mafia, living } = await dayRoom();
    must(await env.service.sendChat(room.code, mafia, "I'm just a villager"));
    const seen = env.broadcaster.chatsTo(living).at(-1);
    expect(seen).toMatchObject({ channel: "public", text: "I'm just a villager" });
  });

  it("keeps eliminated players' messages in the spectator channel, away from the living", async () => {
    const { env, room, dead, living } = await dayRoom();
    must(await env.service.sendChat(room.code, dead, "it was the quiet one"));
    expect(env.broadcaster.chatsTo(living).map((m) => m.text)).not.toContain("it was the quiet one");
    expect(env.broadcaster.chatsTo(dead).at(-1)).toMatchObject({ channel: "graveyard" });
    // and the living can't hear it later either
    must(await env.service.sendSnapshot(room.code, living));
    const history = env.broadcaster.to(living).filter((x) => x.kind === "history");
    expect(JSON.stringify(history)).not.toContain("quiet one");
  });

  it("sends reactions the same way, and they never carry text", async () => {
    const { env, room, dead, living, mafia } = await dayRoom();
    must(await env.service.sendReaction(room.code, living, "suspicious"));
    expect(env.broadcaster.chatsTo(mafia).at(-1)).toMatchObject({ channel: "public", reaction: "suspicious", text: "" });
    must(await env.service.sendReaction(room.code, dead, "laughing"));
    expect(env.broadcaster.chatsTo(living).some((m) => m.reaction === "laughing")).toBe(false);
    expect(env.broadcaster.chatsTo(dead).at(-1)).toMatchObject({ channel: "graveyard", reaction: "laughing" });
    const bad = await env.service.sendReaction(room.code, living, "dancing" as never);
    expect(!bad.ok && bad.error.code).toBe("BAD_REQUEST");
  });

  it("locks every channel at night except the Mafia's, for typed text and reactions alike", async () => {
    const env = makeService();
    const room = await startedRoom(env, 8);
    const [m1, m2] = room.withRole("mafia") as [string, string];
    const [villager] = room.withRole("villager") as [string];
    for (const id of [m1, villager]) {
      const early = await env.service.sendReaction(room.code, id, "thinking"); // role reveal
      expect(!early.ok && early.error.code).toBe("CHAT_NOT_ALLOWED");
    }
    await env.fireTimer(room.code); // NIGHT
    const shut = await env.service.sendReaction(room.code, villager, "thinking");
    expect(!shut.ok && shut.error.code).toBe("CHAT_NOT_ALLOWED");
    must(await env.service.sendReaction(room.code, m1, "thinking"));
    expect(env.broadcaster.chatsTo(m2).at(-1)).toMatchObject({ channel: "mafia", reaction: "thinking" });
    expect(env.broadcaster.chatsTo(villager)).toEqual([]);
  });

  it("limits message length to the maximum", async () => {
    const { env, room, living } = await dayRoom();
    must(await env.service.sendChat(room.code, living, "x".repeat(300)));
    const long = await env.service.sendChat(room.code, living, "x".repeat(301));
    expect(!long.ok && long.error.code).toBe("BAD_REQUEST");
  });
});

describe("connections and clean-up", () => {
  it("marks players disconnected and back", async () => {
    const env = makeService();
    const { code, ids } = await roomWith(env, 2);
    must(await env.service.setConnected(code, ids[1] ?? "", false));
    expect(env.broadcaster.lastState(ids[0] ?? "").view.players[1]?.connected).toBe(false);
    must(await env.service.setConnected(code, ids[1] ?? "", true));
    expect(env.broadcaster.lastState(ids[0] ?? "").view.players[1]?.connected).toBe(true);
    // no-op when nothing changes
    const before = env.broadcaster.sent.length;
    must(await env.service.setConnected(code, ids[1] ?? "", true));
    expect(env.broadcaster.sent.length).toBe(before);
  });

  it("drops lobby players who stay away", async () => {
    const env = makeService({ lobbyDropMs: 60_000 });
    const { code, ids } = await roomWith(env, 3);
    must(await env.service.setConnected(code, ids[2] ?? "", false));
    env.clock.now += 59_000;
    await env.service.sweep();
    expect((await env.store.get(code))?.state.players).toHaveLength(3);
    env.clock.now += 2_000;
    await env.service.sweep();
    expect((await env.store.get(code))?.state.players).toHaveLength(2);
    expect(env.broadcaster.to(ids[2] ?? "").some((s) => s.kind === "removed" && s.payload.reason === "dropped")).toBe(
      true,
    );
  });

  it("closes a lobby once everyone has been away too long", async () => {
    const env = makeService({ lobbyDropMs: 60_000 });
    const { code, ids } = await roomWith(env, 2);
    for (const id of ids) must(await env.service.setConnected(code, id, false));
    env.clock.now += 61_000;
    await env.service.sweep();
    expect(await env.store.get(code)).toBeUndefined();
  });

  it("keeps a game that has no one connected only until the empty-room limit", async () => {
    const env = makeService({ emptyRoomTtlMs: 300_000 });
    const room = await startedRoom(env, 5);
    for (const id of room.ids) must(await env.service.setConnected(room.code, id, false));
    // timers keep running but don't count as activity
    for (let i = 0; i < 5; i++) await env.fireTimer(room.code);
    env.clock.now += 300_000;
    await env.service.sweep();
    expect(await env.store.get(room.code)).toBeUndefined();
    expect(env.scheduler.at(room.code)).toBeUndefined();
  });

  it("closes rooms nobody has used for hours", async () => {
    const env = makeService({ idleRoomTtlMs: 3_600_000 });
    const { code, ids } = await roomWith(env, 2);
    env.clock.now += 3_600_000;
    await env.service.sweep();
    expect(await env.store.get(code)).toBeUndefined();
    expect(env.broadcaster.to(ids[0] ?? "").some((s) => s.kind === "removed" && s.payload.reason === "room_closed")).toBe(true);
  });
});
