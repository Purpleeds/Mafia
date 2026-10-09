import { describe, expect, it } from "vitest";
import type { Avatar, RoomNoticeKind } from "@mafia/shared";
import { makeService } from "./testing/fakes.js";
import type { Room } from "./types.js";
import { upgradeRoom } from "./upgrade.js";

const AVATAR: Avatar = { color: "teal", seed: "fox" };
type Env = ReturnType<typeof makeService>;

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function roomWith(env: Env, n: number) {
  const host = must(await env.service.createRoom("Host", AVATAR));
  const sessions = [host];
  for (let i = 2; i <= n; i++) sessions.push(must(await env.service.joinRoom(host.roomCode, `Player ${i}`, AVATAR)));
  return { code: host.roomCode, ids: sessions.map((s) => s.playerId), sessions };
}

const kinds = (env: Env, player: string): Array<[RoomNoticeKind, string]> =>
  env.broadcaster.noticesTo(player).map((n) => [n.kind, n.name]);

describe("room notices", () => {
  it("tells everyone else who joined, left, was removed, lost their connection or came back", async () => {
    const env = makeService();
    const room = await roomWith(env, 3);
    const [host, two, three] = room.ids as [string, string, string];
    expect(kinds(env, host)).toEqual([
      ["joined", "Player 2"],
      ["joined", "Player 3"],
    ]);
    expect(kinds(env, two)).toEqual([["joined", "Player 3"]]); // never about yourself

    must(await env.service.setConnected(room.code, three, false));
    must(await env.service.setConnected(room.code, three, true));
    must(await env.service.leave(room.code, two));
    expect(kinds(env, host).slice(2)).toEqual([
      ["disconnected", "Player 3"],
      ["reconnected", "Player 3"],
      ["left", "Player 2"],
    ]);

    const four = must(await env.service.joinRoom(room.code, "Player 4", AVATAR)).playerId;
    must(await env.service.act(room.code, { type: "KICK", playerId: host, targetId: four }));
    expect(kinds(env, three).slice(-2)).toEqual([
      ["joined", "Player 4"],
      ["kicked", "Player 4"],
    ]);
  });

  it("doesn't announce a quick reconnect (a page refresh or a locked phone)", async () => {
    const env = makeService();
    const room = await roomWith(env, 2);
    const [host, two] = room.ids as [string, string];
    must(await env.service.markReconnecting(room.code, two));
    must(await env.service.setConnected(room.code, two, true));
    expect(kinds(env, host)).toEqual([["joined", "Player 2"]]);
  });

  it("tells everyone, the new host included, when the host changes", async () => {
    const env = makeService();
    const room = await roomWith(env, 3);
    const [host, two, three] = room.ids as [string, string, string];
    must(await env.service.act(room.code, { type: "TRANSFER_HOST", playerId: host, targetId: two }));
    for (const id of [host, two, three]) expect(kinds(env, id).at(-1)).toEqual(["host_changed", "Player 2"]);
  });
});

describe("the home screen's seat check", () => {
  it("says whether the room still runs and the saved seat is still yours", async () => {
    const env = makeService();
    const room = await roomWith(env, 2);
    const [, two] = room.sessions as [unknown, { sessionToken: string; playerId: string }];
    expect(must(await env.service.checkSeat(room.code, two.sessionToken))).toEqual({ roomCode: room.code, stage: "lobby", seatValid: true });
    must(await env.service.leave(room.code, two.playerId));
    expect(must(await env.service.checkSeat(room.code, two.sessionToken)).seatValid).toBe(false);
    const missing = await env.service.checkSeat("ZZZZ", two.sessionToken);
    expect(!missing.ok && missing.error.code).toBe("ROOM_NOT_FOUND");
  });
});

describe("the host's remembered settings", () => {
  it("starts a new room with them, or with the defaults if anything in them is wrong", async () => {
    const env = makeService();
    const good = must(await env.service.createRoom("Ana", AVATAR, { settings: { contentMode: "normal", chatFilter: "uncensored", showVotes: false } }));
    const kept = (await env.store.get(good.roomCode))?.state.settings;
    expect(kept).toMatchObject({ contentMode: "normal", chatFilter: "uncensored", showVotes: false });

    const bad = must(await env.service.createRoom("Ben", AVATAR, { settings: { contentMode: "normal", timers: { nightSeconds: 9999 } } }));
    expect((await env.store.get(bad.roomCode))?.state.settings).toMatchObject({ contentMode: "safe", chatFilter: "strict" });
  });
});

describe("rooms saved by the previous version", () => {
  it("are brought up to date: the old on/off chat filter becomes a level, new fields get defaults", async () => {
    const env = makeService();
    const room = await roomWith(env, 2);
    const stored = (await env.store.get(room.code)) as Room;
    const old = structuredClone(stored) as unknown as { state: Record<string, unknown> & { settings: Record<string, unknown>; players: Record<string, unknown>[] } };
    const settings = old.state.settings;
    delete settings.chatFilter;
    delete settings.customAvatars;
    settings.contentMode = "normal";
    settings.profanityFilter = false;
    for (const key of ["gameNumber", "paused", "discussionDone", "log"]) delete old.state[key];
    for (const p of old.state.players) delete p.ready;

    const upgraded = old as unknown as Room;
    upgradeRoom(upgraded);
    expect(upgraded.state.settings).toMatchObject({ contentMode: "normal", chatFilter: "uncensored", customAvatars: "on" });
    expect(upgraded.state.settings).not.toHaveProperty("profanityFilter");
    expect(upgraded.state).toMatchObject({ gameNumber: 0, paused: null, discussionDone: [], log: [] });
    expect(upgraded.state.players.every((p) => p.ready === false)).toBe(true);

    // An old Safe Mode room is always strict.
    const safe = structuredClone(old) as unknown as Room & { state: { settings: Record<string, unknown> } };
    (safe.state.settings as Record<string, unknown>).contentMode = "safe";
    upgradeRoom(safe);
    expect(safe.state.settings.chatFilter).toBe("strict");

    // And the service uses the upgraded room as if nothing happened.
    await env.store.save(upgraded);
    must(await env.service.sendChat(room.code, room.ids[0] as string, "hello"));
  });
});
