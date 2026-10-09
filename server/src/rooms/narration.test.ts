import { NARRATION_TIMEOUT_MS, ROLES, type Avatar, type NarratorRequestPayload, type Role } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { makeService } from "./testing/fakes.js";

const AVATAR: Avatar = { color: "teal", seed: "fox" };

type Env = ReturnType<typeof makeService>;

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function startedRoom(env: Env, settings: Record<string, unknown> = {}, n = 8) {
  const host = must(await env.service.createRoom("Host", AVATAR));
  const ids = [host.playerId];
  for (let i = 2; i <= n; i++) ids.push(must(await env.service.joinRoom(host.roomCode, `Player ${i}`, AVATAR)).playerId);
  const code = host.roomCode;
  const [hostId] = ids as [string];
  must(await env.service.act(code, { type: "UPDATE_SETTINGS", playerId: hostId, settings }));
  must(await env.service.act(code, { type: "START_GAME", playerId: hostId }));
  const stored = await env.store.get(code);
  const roleOf = new Map<string, Role>();
  for (const p of stored?.state.players ?? []) if (p.role) roleOf.set(p.id, p.role);
  const withRole = (role: Role) => ids.filter((id) => roleOf.get(id) === role);
  const nameOf = (id: string) => stored?.state.players.find((p) => p.id === id)?.name ?? "?";
  return { code, ids, hostId, roleOf, withRole, nameOf };
}

type Room = Awaited<ReturnType<typeof startedRoom>>;

/** Plays to the morning news; the Mafia picks `victim` (or nobody, for a quiet night). */
async function toMorning(env: Env, room: Room, victim?: string) {
  await env.fireTimer(room.code); // ROLE_REVEAL -> NIGHT
  if (victim) {
    const [mafia] = room.withRole("mafia") as [string];
    must(await env.service.act(room.code, { type: "NIGHT_ACTION", playerId: mafia, targetId: victim }));
  }
  await env.fireTimer(room.code); // NIGHT -> NIGHT_RESULTS
}

const stored = async (env: Env, room: Room) => (await env.store.get(room.code))?.state;

/** The first narrator request sent to anyone. */
function firstRequest(env: Env): { player: string; payload: NarratorRequestPayload } {
  const [first] = env.broadcaster.narrationRequests();
  if (!first) throw new Error("no narrator request was sent");
  return first;
}

/** A victim who isn't the host (so the host's own name isn't in play) and isn't Mafia. */
const villagerVictim = (room: Room) => room.withRole("villager").find((id) => id !== room.hostId) ?? "";

describe("asking the host's browser for a narration", () => {
  it("sends the request to the host and nobody else, with public facts only", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    const victim = villagerVictim(room);
    await toMorning(env, room, victim);

    expect(env.broadcaster.narrationRequests()).toHaveLength(1);
    const request = firstRequest(env);
    expect(request.player).toBe(room.hostId);
    expect(request.payload.timeoutMs).toBe(NARRATION_TIMEOUT_MS);
    expect(request.payload.facts).toEqual({
      kind: "night",
      mode: "safe",
      round: 1,
      gang: "Mafia",
      eliminated: [{ name: room.nameOf(victim), how: "night" }],
      saved: false,
      voteOutcome: null,
    });

    // The request carries no role, no id and no other name.
    const json = JSON.stringify(request.payload);
    for (const id of room.ids) expect(json).not.toContain(id);
    const plain = JSON.stringify({ ...request.payload.facts, gang: "" }).toLowerCase();
    for (const role of ROLES) expect(plain).not.toContain(role);
    for (const id of room.ids.filter((i) => i !== victim)) expect(json).not.toContain(room.nameOf(id));

    // Nobody else was ever sent anything of the kind, and the request id never appears in anyone's game state.
    expect(env.broadcaster.sent.filter((s) => s.kind === "narration" && s.player !== room.hostId)).toEqual([]);
    for (const s of env.broadcaster.sent) {
      if (s.kind === "state") expect(JSON.stringify(s.payload)).not.toContain(request.payload.requestId);
    }
  });

  it("shows everyone a thinking narrator until the host answers", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    await toMorning(env, room);
    for (const id of room.ids) {
      expect(env.broadcaster.lastState(id).view.narration).toMatchObject({ kind: "night", status: "thinking", text: null });
    }
  });

  it("broadcasts the AI's narration to everyone once the host sends it", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    const victim = villagerVictim(room);
    await toMorning(env, room, victim);
    const { payload } = firstRequest(env);
    const text = `A cold wind blew through the village, and ${room.nameOf(victim)} was whisked away by the Mafia.`;
    must(await env.service.submitNarration(room.code, room.hostId, payload.requestId, text));
    for (const id of room.ids) {
      expect(env.broadcaster.lastState(id).view.narration).toEqual({
        kind: "night",
        round: 1,
        status: "ready",
        text,
        source: "ai",
      });
    }
  });

  it("uses a ready-made line when the AI's text isn't fit (Safe Mode: violence words)", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    const victim = villagerVictim(room);
    await toMorning(env, room, victim);
    const { payload } = firstRequest(env);
    must(
      await env.service.submitNarration(room.code, room.hostId, payload.requestId, `${room.nameOf(victim)} was stabbed and killed.`),
    );
    const narration = env.broadcaster.lastState(room.ids[2] ?? "").view.narration;
    expect(narration).toMatchObject({ status: "ready", source: "template" });
    expect(narration?.text).toContain(room.nameOf(victim));
    expect(narration?.text).not.toMatch(/stab|kill/i);
    expect((await stored(env, room))?.narration?.fallback).toBe("rejected_banned_word");
    expect(env.logger.lines.some((l) => l.includes("narration.ready") && l.includes("fallback=rejected_banned_word"))).toBe(true);
  });

  it("uses a ready-made line straight away if the host's browser says it can't (not signed in, error)", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    await toMorning(env, room, villagerVictim(room));
    const { payload } = firstRequest(env);
    must(await env.service.submitNarration(room.code, room.hostId, payload.requestId, null));
    expect((await stored(env, room))?.narration).toMatchObject({ status: "ready", source: "template", fallback: "ai_failed" });
    expect(env.broadcaster.lastState(room.ids[1] ?? "").view.narration?.status).toBe("ready");
  });

  it("falls back to a ready-made line after 6 seconds without an answer (timeout)", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    const victim = villagerVictim(room);
    await toMorning(env, room, victim);
    const narrationStarted = env.clock.now;
    // the timer is armed for the narrator's deadline, not the end of the phase
    expect(env.scheduler.at(room.code)).toBe(narrationStarted + NARRATION_TIMEOUT_MS);

    await env.fireTimer(room.code);
    const state = await stored(env, room);
    expect(env.clock.now).toBe(narrationStarted + NARRATION_TIMEOUT_MS);
    expect(state?.narration).toMatchObject({ status: "ready", source: "template", fallback: "timeout" });
    expect(state?.narration?.text).toContain(room.nameOf(victim));
    expect(state?.phase).toBe("NIGHT_RESULTS");
    // everyone sees it, and the timer is back on the phase, with time to read
    for (const id of room.ids) expect(env.broadcaster.lastState(id).view.narration).toMatchObject({ status: "ready", source: "template" });
    expect(env.scheduler.at(room.code)).toBe(state?.phaseEndsAt);
    expect((state?.phaseEndsAt ?? 0) - env.clock.now).toBeGreaterThanOrEqual(4000);
  });

  it("never shows the host's late answer once the ready-made line has been used", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    const victim = villagerVictim(room);
    await toMorning(env, room, victim);
    const { payload } = firstRequest(env);
    await env.fireTimer(room.code);
    const before = (await stored(env, room))?.narration?.text;
    must(await env.service.submitNarration(room.code, room.hostId, payload.requestId, `Too late, but ${room.nameOf(victim)} was whisked away.`));
    expect((await stored(env, room))?.narration?.text).toBe(before);
  });

  it("only takes the host's answer, to the request that is waiting", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    const victim = villagerVictim(room);
    await toMorning(env, room, victim);
    const { payload } = firstRequest(env);
    const text = `${room.nameOf(victim)} was whisked away by the Mafia.`;

    const impostor = room.ids.find((id) => id !== room.hostId) ?? "";
    const refused = await env.service.submitNarration(room.code, impostor, payload.requestId, text);
    expect(!refused.ok && refused.error.code).toBe("NOT_HOST");
    must(await env.service.submitNarration(room.code, room.hostId, "somethingelse", text)); // ignored
    expect((await stored(env, room))?.narration?.status).toBe("pending");

    must(await env.service.submitNarration(room.code, room.hostId, payload.requestId, text));
    expect((await stored(env, room))?.narration).toMatchObject({ status: "ready", source: "ai" });
    // a second answer changes nothing
    must(await env.service.submitNarration(room.code, room.hostId, payload.requestId, `${room.nameOf(victim)} went away.`));
    expect((await stored(env, room))?.narration?.text).toBe(text);
  });

  it("asks the new host if hosting passes on, and nobody else", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    await env.fireTimer(room.code); // NIGHT
    must(await env.service.setConnected(room.code, room.hostId, false)); // host drops: hosting passes to the next player
    const next = (await stored(env, room))?.hostId;
    expect(next).not.toBe(room.hostId);
    await env.fireTimer(room.code); // NIGHT -> NIGHT_RESULTS
    const requests = env.broadcaster.narrationRequests();
    expect(requests.map((r) => r.player)).toEqual([next]);
  });

  it("uses a ready-made line at once if nobody is connected to ask", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    await env.fireTimer(room.code); // NIGHT
    for (const id of room.ids) must(await env.service.setConnected(room.code, id, false));
    await env.fireTimer(room.code); // NIGHT -> NIGHT_RESULTS
    expect(env.broadcaster.narrationRequests()).toEqual([]);
    expect((await stored(env, room))?.narration).toMatchObject({ status: "ready", source: "template", fallback: "host_away" });
  });

  it("asks again after the day's vote, with that vote's facts", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    await toMorning(env, room);
    const { payload: first } = firstRequest(env);
    must(await env.service.submitNarration(room.code, room.hostId, first.requestId, null));
    await env.fireTimer(room.code); // -> DAY_DISCUSSION
    await env.fireTimer(room.code); // -> VOTING
    await env.fireTimer(room.code); // -> VOTE_RESULTS (nobody voted: skipped)
    const requests = env.broadcaster.narrationRequests();
    expect(requests).toHaveLength(2);
    const second = requests[1]?.payload as NarratorRequestPayload;
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.facts).toMatchObject({ kind: "vote", round: 1, eliminated: [], voteOutcome: "skipped" });
  });
});

describe("with the AI narrator off", () => {
  it("never asks anyone, and has the morning news ready at once", async () => {
    const env = makeService();
    const room = await startedRoom(env, {});
    const victim = villagerVictim(room);
    await toMorning(env, room, victim);
    expect(env.broadcaster.narrationRequests()).toEqual([]);
    const narration = env.broadcaster.lastState(room.ids[3] ?? "").view.narration;
    expect(narration).toMatchObject({ status: "ready", source: "template" });
    expect(narration?.text).toContain(room.nameOf(victim));
  });
});

describe("players can't force a narration or a tick", () => {
  it("rejects system actions sent through the player path", async () => {
    const env = makeService();
    const room = await startedRoom(env, { aiNarrator: true });
    for (const action of [{ type: "NARRATE", candidate: "hello" }, { type: "TICK" }, { type: "JOIN", playerId: "x", name: "X", avatar: AVATAR }]) {
      const result = await env.service.act(room.code, action as never);
      expect(!result.ok && result.error.code).toBe("BAD_REQUEST");
    }
  });
});

describe("content modes in a room", () => {
  it("can't be switched once the game has started", async () => {
    const env = makeService();
    const room = await startedRoom(env, {});
    const result = await env.service.act(room.code, {
      type: "UPDATE_SETTINGS",
      playerId: room.hostId,
      settings: { contentMode: "normal" },
    });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
    expect((await stored(env, room))?.settings.contentMode).toBe("safe");
  });

  it("shows every player the mode and the Sneaky Gang setting in their view", async () => {
    const env = makeService();
    const room = await startedRoom(env, { sneakyGang: true });
    for (const id of room.ids) {
      expect(env.broadcaster.lastState(id).view.settings).toMatchObject({ contentMode: "safe", sneakyGang: true, chatFilter: "strict" });
    }
  });
});

describe("the chat filter", () => {
  async function lobbyOf(env: Env, settings: Record<string, unknown> = {}) {
    const host = must(await env.service.createRoom("Host", AVATAR));
    const other = must(await env.service.joinRoom(host.roomCode, "Friend", AVATAR));
    if (Object.keys(settings).length > 0) {
      must(await env.service.act(host.roomCode, { type: "UPDATE_SETTINGS", playerId: host.playerId, settings }));
    }
    return { code: host.roomCode, host: host.playerId, friend: other.playerId };
  }
  const say = async (env: Env, room: { code: string; host: string }, text: string) => {
    must(await env.service.sendChat(room.code, room.host, text));
    const received = env.broadcaster.chatsTo(room.host);
    return received[received.length - 1]?.text;
  };

  const MILD = "damn it, you idiot";
  const STRONG = "that was shit luck";

  it("is always strict in Safe Mode: strong and mild words are hidden, and it can't be loosened", async () => {
    const env = makeService();
    const room = await lobbyOf(env);
    expect(await say(env, room, STRONG)).toBe("that was **** luck");
    expect(await say(env, room, "you fucking cheat")).toBe("you ******* cheat"); // the whole word goes
    expect(await say(env, room, MILD)).toBe("**** it, you *****");
    expect(await say(env, room, "hello friends, nice game")).toBe("hello friends, nice game");
    for (const chatFilter of ["standard", "uncensored"]) {
      const looser = await env.service.act(room.code, { type: "UPDATE_SETTINGS", playerId: room.host, settings: { chatFilter } });
      expect(!looser.ok && looser.error.code, chatFilter).toBe("INVALID_SETTINGS");
    }
    expect(await say(env, room, "still shit")).toBe("still ****");
  });

  it("starts on standard in Normal Mode: strong words are hidden, mild ones are not", async () => {
    const env = makeService();
    const room = await lobbyOf(env, { contentMode: "normal" });
    expect(env.broadcaster.lastState(room.friend).view.settings.chatFilter).toBe("standard");
    expect(await say(env, room, STRONG)).toBe("that was **** luck");
    expect(await say(env, room, MILD)).toBe(MILD);
    expect(await say(env, room, "just kys")).toBe("just ***");
  });

  it("can be strict or uncensored in Normal Mode, and everyone is told which", async () => {
    const env = makeService();
    const room = await lobbyOf(env, { contentMode: "normal", chatFilter: "strict" });
    expect(await say(env, room, MILD)).toBe("**** it, you *****");
    must(await env.service.act(room.code, { type: "UPDATE_SETTINGS", playerId: room.host, settings: { chatFilter: "uncensored" } }));
    expect(env.broadcaster.lastState(room.friend).view.settings.chatFilter).toBe("uncensored");
    expect(await say(env, room, STRONG)).toBe(STRONG);
    expect(await say(env, room, MILD)).toBe(MILD);
  });

  it("goes back to strict when the host returns to Safe Mode", async () => {
    const env = makeService();
    const room = await lobbyOf(env, { contentMode: "normal", chatFilter: "uncensored" });
    must(await env.service.act(room.code, { type: "UPDATE_SETTINGS", playerId: room.host, settings: { contentMode: "safe" } }));
    expect(await say(env, room, STRONG)).toBe("that was **** luck");
  });

  it("blocks links at every level, uncensored included, and keeps the other limits", async () => {
    for (const settings of [{}, { contentMode: "normal" }, { contentMode: "normal", chatFilter: "uncensored" }]) {
      const env = makeService();
      const room = await lobbyOf(env, settings);
      for (const link of ["free robux at https://scam.example", "go to www.example.com", "discord.gg/abc", "bit.ly/x1", "example dot com"]) {
        const result = await env.service.sendChat(room.code, room.host, link);
        expect(!result.ok && result.error.code, `${JSON.stringify(settings)} ${link}`).toBe("CHAT_LINK");
      }
      expect(env.broadcaster.chatsTo(room.friend)).toEqual([]);
      const long = await env.service.sendChat(room.code, room.host, "a".repeat(301));
      expect(!long.ok && long.error.code).toBe("BAD_REQUEST");
      must(await env.service.sendChat(room.code, room.host, "ok.so who is it? e.g. Ana"));
    }
  });

  it("filters whatever channel the message goes to, and keeps what was said otherwise intact", async () => {
    const env = makeService();
    const room = await startedRoom(env, {});
    await env.fireTimer(room.code); // NIGHT
    const [mafia] = room.withRole("mafia") as [string];
    must(await env.service.sendChat(room.code, mafia, "pick the shitty one"));
    const sent = env.broadcaster.chatsTo(mafia).pop();
    expect(sent?.text).toBe("pick the ****** one");
  });
});
