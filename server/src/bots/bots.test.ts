import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOT_DIFFICULTIES,
  MAX_BOTS,
  MAX_PLAYERS,
  findBannedWord,
  presetPatch,
  validateNickname,
  type BotDifficulty,
  type ChatMessage,
  type ContentMode,
  type GameView,
  type SettingsPatch,
} from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { R7, R8, gameWithRoles } from "../game/testing/harness.js";
import { getGameView } from "../game/view.js";
import { chooseNight, chooseVote, newMind, observe } from "./brain.js";
import { BOT_LINES, fillLine } from "./lines.js";
import { BOT_NAMES, freeBotName } from "./names.js";
import { AVATAR, botTable, must } from "./testing/sim.js";

type Table = ReturnType<typeof botTable>;

const EMOJI = /\p{Extended_Pictographic}/u;

/** Everything a seat has been sent over its "socket" (the fake broadcaster): chat ids and the latest view. */
function sentTo(t: Table, seat: string) {
  const chatIds = new Set<string>();
  for (const s of t.env.broadcaster.to(seat)) {
    if (s.kind === "chat") chatIds.add(s.payload.id);
    if (s.kind === "history") for (const m of s.payload.messages) chatIds.add(m.id);
  }
  return { chatIds, view: t.env.broadcaster.lastState(seat).view };
}

/** Before the game is over, a seat's view holds only what its role may know. */
function expectNoHiddenInfo(view: GameView, label: string) {
  const you = view.you;
  if (!you || view.phase === "LOBBY" || view.phase === "GAME_OVER") return;
  for (const p of view.players) {
    // Only an eliminated player's role can be public (when the host reveals roles).
    const revealed = view.settings.revealRoleOnDeath && !p.alive;
    if (p.id !== you.id && !revealed) expect(p.role, `${label}: role of ${p.name}`).toBeNull();
  }
  if (you.role !== "mafia") {
    expect(you.teammateIds, label).toEqual([]);
    expect(you.chat.read, label).not.toContain("mafia");
  }
  if (you.role !== "detective") expect(you.investigations, label).toEqual([]);
  if (you.role !== "doctor") expect(you.protectedId, label).toBeNull();
  if (you.role !== "cupid" && you.loverIds) expect(you.loverIds, label).toContain(you.id);
  if (you.nightAction && you.nightAction.kind !== "kill") expect(you.nightAction.teammateVotes ?? {}, label).toEqual({});
  expect(view.timeline, label).toEqual([]);
  expect(view.stats, label).toBeNull();
}

/** Every bot seat has exactly what that seat's socket was sent, and nothing its role shouldn't know. */
async function checkBotSeats(t: Table, code: string) {
  const state = await t.state(code);
  if (!state) return;
  const seats = t.bots.seatIds(code);
  const expected = state.players.filter((p) => p.isBot || p.botControlled).map((p) => p.id);
  expect([...seats].sort()).toEqual([...expected].sort());
  for (const id of seats) {
    const got = t.bots.received(code, id);
    const sent = sentTo(t, id);
    expect(got?.view, `view of ${id}`).toEqual(sent.view);
    for (const m of got?.chat ?? []) expect(sent.chatIds.has(m.id), `chat ${m.id} to ${id}`).toBe(true);
    if (got?.view) expectNoHiddenInfo(got.view, id);
  }
}

interface GameOptions {
  difficulty: BotDifficulty;
  mode: ContentMode;
  players: number;
  settings?: SettingsPatch;
  /** The host steps away right after starting, so every seat is played by a bot. */
  hostAway?: boolean;
}

/** A whole solo-practice game, checking the bot seats after every step. Returns the table and the room. */
async function playGame(seed: number, o: GameOptions) {
  const t = botTable(seed);
  const { code, hostId } = await t.room(o.players, {
    contentMode: o.mode,
    soloPractice: true,
    botDifficulty: o.difficulty,
    revealRoleOnDeath: false,
    ...o.settings,
  });
  must(await t.env.service.act(code, { type: "START_GAME", playerId: hostId }));
  if (o.hostAway) must(await t.env.service.setConnected(code, hostId, false));
  else must(await t.env.service.act(code, { type: "ACK_ROLE", playerId: hostId }));

  // When each phase started, to check how long bots waited.
  const phaseStarts: Array<{ key: string; at: number; endsAt: number | null }> = [];
  await t.runUntil(code, async () => {
    const s = await t.state(code);
    if (!s) return true;
    const key = `${s.phase}:${s.round}:${s.voting?.round ?? 0}`;
    if (phaseStarts.at(-1)?.key !== key) phaseStarts.push({ key, at: t.env.clock.now, endsAt: s.phaseEndsAt });
    await checkBotSeats(t, code);
    return s.phase === "GAME_OVER";
  });
  return { t, code, hostId, phaseStarts, final: await t.state(code) };
}

function warnings(t: Table): string[] {
  return t.env.logger.lines.filter((l) => l.includes("bot.action_rejected") || l.includes("bot.failed"));
}

function botChats(t: Table, hostId: string): ChatMessage[] {
  return t.env.broadcaster.chatsTo(hostId).filter((m) => m.senderId !== hostId && m.text !== "");
}

// ---------------------------------------------------------------- fair play

describe("what a bot knows", () => {
  it("is exactly the personal view and chat its seat's socket gets, with nothing hidden from its role", async () => {
    // checkBotSeats runs after every step of the game.
    const { final, t } = await playGame(4, { difficulty: "normal", mode: "normal", players: 8, settings: presetPatch("chaos") });
    expect(final?.phase).toBe("GAME_OVER");
    expect(warnings(t)).toEqual([]);
  });

  it("holds no other player's role, team or night results, whatever the bot's role", () => {
    const g = gameWithRoles(R8);
    g.nightAct("p1", "p5"); // the Mafia's pick
    g.nightAct("p3", "p6"); // the Doctor
    g.nightAct("p4", "p1"); // the Detective finds the Mafia
    g.nightAct("p2", "p5");
    if (g.phase === "NIGHT") g.endPhase();
    const town = JSON.stringify(getGameView(g.state, "p6"));
    expect(town).not.toContain('"role":"mafia"');
    expect(town).not.toContain("teammateVotes\":{");
    expect(getGameView(g.state, "p6").you?.teammateIds).toEqual([]);
    expect(getGameView(g.state, "p3").you?.investigations).toEqual([]);
    expect(getGameView(g.state, "p4").you?.investigations).toEqual([{ round: 1, targetId: "p1", isMafia: true }]);
    expect(getGameView(g.state, "p2").you?.teammateIds).toEqual(["p1"]);
    for (const id of ["p3", "p4", "p5", "p6"]) expectNoHiddenInfo(getGameView(g.state, id), id);
  });

  it("can't reach the server's game state: the bot code only imports the shared types, its own files and the logger", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.sort()).toEqual(["brain.ts", "lines.ts", "manager.ts", "names.ts", "port.ts"]);
    for (const file of files) {
      // Comments may talk about the game state; the code itself may not touch it.
      const source = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
      for (const from of imports) {
        const allowed = from === "@mafia/shared" || from === "../logger.js" || /^\.\/[a-z]+\.js$/.test(from);
        expect(allowed, `${file} imports ${from}`).toBe(true);
      }
      expect(source, file).not.toMatch(/\bGameState\b|roomStore|RoomStore|getGameView/);
    }
  });
});

// ---------------------------------------------------------------- validation

describe("bot moves", () => {
  async function started(seed = 2) {
    const t = botTable(seed);
    const { code, hostId } = await t.room(5, { soloPractice: true });
    must(await t.env.service.act(code, { type: "START_GAME", playerId: hostId }));
    const state = await t.state(code);
    const bots = state?.players.filter((p) => p.isBot) ?? [];
    return { t, code, hostId, bots };
  }

  it("go through the same checks as a human's", async () => {
    const { t, code, hostId, bots } = await started();
    const bot = bots[0]?.id ?? "";
    const port = t.env.service;
    // Not a bot's seat.
    expect(await port.botAct(code, hostId, { type: "ACK_ROLE" })).toMatchObject({ ok: false, error: { code: "NOT_IN_ROOM" } });
    expect(await port.botChat(code, hostId, "hi")).toMatchObject({ ok: false, error: { code: "NOT_IN_ROOM" } });
    // Only what a player could send for their own seat.
    const kick = { type: "KICK", targetId: hostId } as never;
    expect(await port.botAct(code, bot, kick)).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    // The engine's own rules: wrong phase, bad targets.
    expect(await port.botAct(code, bot, { type: "CAST_VOTE", targetId: hostId })).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
    must(await port.botAct(code, bot, { type: "ACK_ROLE" }));
    for (const b of bots.slice(1)) must(await port.botAct(code, b.id, { type: "ACK_ROLE" }));
    must(await t.env.service.act(code, { type: "ACK_ROLE", playerId: hostId }));
    expect((await t.state(code))?.phase).toBe("NIGHT");
    const night = await port.botAct(code, bot, { type: "NIGHT_ACTION", targetId: "nobody" });
    expect(night.ok).toBe(false);
    expect(["INVALID_TARGET", "NO_ABILITY"]).toContain(!night.ok && night.error.code);
    // The chat rules too.
    expect(await port.botChat(code, bot, "see www.example.com")).toMatchObject({ ok: false });
  });

  it("are refused for a bot that is out of the game", async () => {
    const t = botTable(3);
    const { code, hostId } = await t.room(6, { soloPractice: true, revealRoleOnDeath: true });
    must(await t.env.service.act(code, { type: "START_GAME", playerId: hostId }));
    must(await t.env.service.act(code, { type: "ACK_ROLE", playerId: hostId }));
    await t.runUntil(code, async () => {
      const s = await t.state(code);
      return !s || s.phase === "GAME_OVER" || (s.phase === "VOTING" && s.players.some((p) => p.isBot && !p.alive));
    });
    const s = await t.state(code);
    const dead = s?.players.find((p) => p.isBot && !p.alive);
    if (s?.phase !== "VOTING" || !dead) return; // this seed's game ended first: nothing to check
    const vote = await t.env.service.botAct(code, dead.id, { type: "CAST_VOTE", targetId: hostId });
    expect(vote).toMatchObject({ ok: false, error: { code: "DEAD_PLAYER" } });
  });

  it("wait a varied, human-like 4 seconds or more before night actions and votes", async () => {
    const { t, phaseStarts } = await playGame(5, { difficulty: "normal", mode: "safe", players: 7 });
    const timed = t.moves.filter((m) => m.type === "NIGHT_ACTION" || m.type === "CAST_VOTE");
    expect(timed.length).toBeGreaterThan(5);
    const waits = timed.map((m) => {
      const start = [...phaseStarts].reverse().find((p) => p.at <= m.at);
      if (!start) throw new Error("no phase");
      // A wait is only shortened to fit inside the phase's own timer.
      const room = start.endsAt === null ? Infinity : start.endsAt - start.at;
      if (room >= 17_000) expect(m.at - start.at, m.type).toBeGreaterThanOrEqual(4000);
      return m.at - start.at;
    });
    expect(Math.max(...waits)).toBeLessThanOrEqual(15_000);
    expect(new Set(waits.map((w) => Math.round(w / 500))).size).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------- whole games

describe("all-bot games", () => {
  for (const difficulty of BOT_DIFFICULTIES) {
    for (const mode of ["safe", "normal"] as ContentMode[]) {
      for (const seed of [1, 2, 3]) {
        it(`finish at ${difficulty} difficulty in ${mode} mode (seed ${seed})`, async () => {
          const { t, final, hostId } = await playGame(seed * 11, { difficulty, mode, players: 5 + seed * 2, hostAway: true });
          expect(final?.phase).toBe("GAME_OVER");
          expect(final?.winner).not.toBeNull();
          expect(warnings(t)).toEqual([]);
          const lines = botChats(t, hostId);
          for (const m of lines) {
            expect(m.text).not.toMatch(EMOJI);
            if (mode === "safe") expect(findBannedWord(m.text, "safe"), m.text).toBeNull();
          }
        });
      }
    }
  }

  it("finish with every optional role in play", async () => {
    for (const difficulty of BOT_DIFFICULTIES) {
      const { final, t } = await playGame(21, { difficulty, mode: "safe", players: 9, hostAway: true, settings: presetPatch("chaos") });
      expect(final?.phase).toBe("GAME_OVER");
      expect(warnings(t)).toEqual([]);
    }
  });

  it("keep the day chat to a few lines per phase", async () => {
    const { t, hostId, phaseStarts } = await playGame(8, { difficulty: "normal", mode: "normal", players: 10, hostAway: true });
    const perPhase = new Map<number, number>();
    for (const m of botChats(t, hostId)) {
      const start = [...phaseStarts].reverse().find((p) => p.at <= m.sentAt);
      perPhase.set(start?.at ?? 0, (perPhase.get(start?.at ?? 0) ?? 0) + 1);
    }
    expect(perPhase.size).toBeGreaterThan(0);
    for (const count of perPhase.values()) expect(count).toBeLessThanOrEqual(6);
  });

  it("tell a human Mafia teammate in the Mafia chat who they want, and nobody else hears it", async () => {
    for (let seed = 1; seed < 60; seed++) {
      const t = botTable(seed);
      const { code, hostId } = await t.room(8, { soloPractice: true });
      must(await t.env.service.act(code, { type: "START_GAME", playerId: hostId }));
      const s = await t.state(code);
      if (s?.players.find((p) => p.id === hostId)?.role !== "mafia") continue;
      must(await t.env.service.act(code, { type: "ACK_ROLE", playerId: hostId }));
      await t.runUntil(code, async () => (await t.state(code))?.phase === "DAY_DISCUSSION" || (await t.state(code))?.phase === "GAME_OVER");
      const plan = t.env.broadcaster.chatsTo(hostId).filter((m) => m.channel === "mafia" && m.senderId !== hostId);
      expect(plan.length).toBeGreaterThan(0);
      const town = s.players.filter((p) => p.role !== "mafia").map((p) => p.id);
      for (const id of town) {
        const heard = new Set(sentTo(t, id).chatIds);
        for (const m of plan) expect(heard.has(m.id)).toBe(false);
      }
      return;
    }
    throw new Error("no seed made the host Mafia");
  });
});

// ---------------------------------------------------------------- the lobby

describe("adding bots", () => {
  it("fills a room to the minimum of 5, and no further", async () => {
    const t = botTable(1);
    const host = must(await t.env.service.createRoom("Host", AVATAR));
    expect(must(await t.env.service.fillBots(host.roomCode, host.playerId))).toEqual({ bots: 4, players: 5 });
    expect(must(await t.env.service.fillBots(host.roomCode, host.playerId))).toEqual({ bots: 4, players: 5 });

    const other = must(await t.env.service.createRoom("Host", AVATAR));
    must(await t.env.service.joinRoom(other.roomCode, "Alex", AVATAR));
    must(await t.env.service.joinRoom(other.roomCode, "Jordan", AVATAR));
    expect(must(await t.env.service.fillBots(other.roomCode, other.playerId))).toEqual({ bots: 2, players: 5 });
  });

  it("gives bots fun names that never clash, a generated avatar, and a Bot label", async () => {
    const t = botTable(2);
    const { code, hostId } = await t.room(10);
    const view = t.env.broadcaster.lastState(hostId).view;
    const bots = view.players.filter((p) => p.isBot);
    expect(bots).toHaveLength(9);
    expect(new Set(view.players.map((p) => p.name.toLowerCase())).size).toBe(10);
    for (const b of bots) {
      expect(BOT_NAMES).toContain(b.name);
      expect(b.avatar.photo ?? null).toBeNull();
      expect(b.botPlaying).toBe(false);
    }
    expect(view.players.find((p) => p.id === hostId)?.isBot).toBe(false);
    // Ready straight away.
    expect(bots.every((b) => b.done)).toBe(true);
    expect(code).toBeTruthy();
  });

  it("allows at most 10 bots, within the room's 20-player limit", async () => {
    const t = botTable(3);
    const host = must(await t.env.service.createRoom("Host", AVATAR));
    const code = host.roomCode;
    for (let i = 0; i < MAX_BOTS; i++) must(await t.env.service.addBot(code, host.playerId));
    expect(await t.env.service.addBot(code, host.playerId)).toMatchObject({ ok: false, error: { code: "ROOM_FULL" } });

    const big = must(await t.env.service.createRoom("Host", AVATAR));
    must(await t.env.service.act(big.roomCode, { type: "UPDATE_SETTINGS", playerId: big.playerId, settings: { replaceBots: false } }));
    for (let i = 0; i < 12; i++) must(await t.env.service.joinRoom(big.roomCode, `Person ${i + 1}`, AVATAR));
    for (let i = 0; i < MAX_PLAYERS - 13; i++) must(await t.env.service.addBot(big.roomCode, big.playerId));
    expect((await t.state(big.roomCode))?.players).toHaveLength(MAX_PLAYERS);
    expect(await t.env.service.addBot(big.roomCode, big.playerId)).toMatchObject({ ok: false, error: { code: "ROOM_FULL" } });
  });

  it("is for the host, in the lobby, and Remove takes the newest bot", async () => {
    const t = botTable(4);
    const host = must(await t.env.service.createRoom("Host", AVATAR));
    const code = host.roomCode;
    const guest = must(await t.env.service.joinRoom(code, "Alex", AVATAR));
    expect(await t.env.service.addBot(code, guest.playerId)).toMatchObject({ ok: false, error: { code: "NOT_HOST" } });
    expect(await t.env.service.fillBots(code, guest.playerId)).toMatchObject({ ok: false, error: { code: "NOT_HOST" } });
    expect(await t.env.service.removeBot(code, host.playerId)).toMatchObject({ ok: false, error: { code: "INVALID_TARGET" } });
    must(await t.env.service.fillBots(code, host.playerId));
    const before = (await t.state(code))?.players ?? [];
    expect(must(await t.env.service.removeBot(code, host.playerId))).toEqual({ bots: 2, players: 4 });
    const after = (await t.state(code))?.players ?? [];
    expect(after.map((p) => p.id)).toEqual(before.slice(0, -1).map((p) => p.id));
    expect(t.bots.seatIds(code)).not.toContain(before.at(-1)?.id);

    must(await t.env.service.addBot(code, host.playerId));
    must(await t.env.service.act(code, { type: "START_GAME", playerId: host.playerId }));
    expect(await t.env.service.addBot(code, host.playerId)).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
    expect(await t.env.service.fillBots(code, host.playerId)).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
    expect(await t.env.service.removeBot(code, host.playerId)).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
  });

  it("needs 2 real players to start, unless the host allows solo practice", async () => {
    const t = botTable(5);
    const { code, hostId } = await t.room(5);
    expect(await t.env.service.act(code, { type: "START_GAME", playerId: hostId })).toMatchObject({
      ok: false,
      error: { code: "NOT_ENOUGH_PLAYERS" },
    });
    must(await t.env.service.act(code, { type: "UPDATE_SETTINGS", playerId: hostId, settings: { soloPractice: true } }));
    must(await t.env.service.act(code, { type: "START_GAME", playerId: hostId }));

    // Alex takes a bot's place, so there are 2 people and 3 bots.
    const two = await t.room(5);
    must(await t.env.service.joinRoom(two.code, "Alex", AVATAR));
    expect((await t.state(two.code))?.players.filter((p) => p.isBot)).toHaveLength(3);
    must(await t.env.service.act(two.code, { type: "START_GAME", playerId: two.hostId }));
  });

  it("only lets people be the host", async () => {
    const t = botTable(6);
    const { code, hostId } = await t.room(5);
    const bot = (await t.state(code))?.players.find((p) => p.isBot)?.id ?? "";
    expect(await t.env.service.act(code, { type: "TRANSFER_HOST", playerId: hostId, targetId: bot })).toMatchObject({ ok: false });
  });
});

describe("replacing a bot when someone joins", () => {
  it("keeps the room at the size the host filled it to", async () => {
    const t = botTable(7);
    const { code, hostId } = await t.room(1);
    must(await t.env.service.fillBots(code, hostId));
    const bots = (await t.state(code))?.players.filter((p) => p.isBot) ?? [];
    const newest = bots.at(-1);
    const alex = must(await t.env.service.joinRoom(code, "Alex", AVATAR));
    let players = (await t.state(code))?.players ?? [];
    expect(players).toHaveLength(5);
    expect(players.filter((p) => p.isBot)).toHaveLength(3);
    expect(players.some((p) => p.id === newest?.id)).toBe(false);
    expect(players.some((p) => p.id === alex.playerId)).toBe(true);
    expect(t.env.broadcaster.noticesTo(hostId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "left", playerId: newest?.id, isBot: true }),
        expect.objectContaining({ kind: "joined", playerId: alex.playerId }),
      ]),
    );
    must(await t.env.service.joinRoom(code, "Jordan", AVATAR));
    players = (await t.state(code))?.players ?? [];
    expect(players).toHaveLength(5);
    expect(players.filter((p) => p.isBot)).toHaveLength(2);
  });

  it("lets the room grow when the host turns it off", async () => {
    const t = botTable(8);
    const { code, hostId } = await t.room(1, { replaceBots: false });
    must(await t.env.service.fillBots(code, hostId));
    must(await t.env.service.joinRoom(code, "Alex", AVATAR));
    expect((await t.state(code))?.players).toHaveLength(6);
  });

  it("makes space in a full room", async () => {
    const t = botTable(9);
    const host = must(await t.env.service.createRoom("Host", AVATAR));
    const code = host.roomCode;
    must(await t.env.service.act(code, { type: "UPDATE_SETTINGS", playerId: host.playerId, settings: { replaceBots: false } }));
    for (let i = 0; i < 9; i++) must(await t.env.service.joinRoom(code, `Person ${i + 1}`, AVATAR));
    for (let i = 0; i < MAX_BOTS; i++) must(await t.env.service.addBot(code, host.playerId));
    must(await t.env.service.act(code, { type: "UPDATE_SETTINGS", playerId: host.playerId, settings: { replaceBots: true } }));
    const late = must(await t.env.service.joinRoom(code, "Latecomer", AVATAR));
    expect(late.seat).toBe("player");
    const players = (await t.state(code))?.players ?? [];
    expect(players).toHaveLength(MAX_PLAYERS);
    expect(players.filter((p) => p.isBot)).toHaveLength(MAX_BOTS - 1);
  });

  it("gives a person the name a bot had, and the bot another", async () => {
    const t = botTable(10);
    const { code } = await t.room(3, { replaceBots: false });
    const bot = (await t.state(code))?.players.find((p) => p.isBot);
    const name = bot?.name ?? "";
    const person = must(await t.env.service.joinRoom(code, name, AVATAR));
    const players = (await t.state(code))?.players ?? [];
    expect(players.find((p) => p.id === person.playerId)?.name).toBe(name);
    const renamed = players.find((p) => p.id === bot?.id)?.name;
    expect(renamed).not.toBe(name);
    expect(BOT_NAMES).toContain(renamed);
  });
});

// ---------------------------------------------------------------- disconnected players

describe("a bot standing in for a disconnected player", () => {
  async function twoPeople(settings: SettingsPatch = {}) {
    const t = botTable(12);
    const { code, hostId } = await t.room(1, settings);
    const sam = must(await t.env.service.joinRoom(code, "Sam", AVATAR));
    for (let i = 0; i < 4; i++) must(await t.env.service.addBot(code, hostId));
    must(await t.env.service.act(code, { type: "START_GAME", playerId: hostId }));
    must(await t.env.service.act(code, { type: "ACK_ROLE", playerId: hostId }));
    return { t, code, hostId, samId: sam.playerId };
  }

  it("takes over after the grace period, with exactly Sam's knowledge, and gives control back", async () => {
    const { t, code, hostId, samId } = await twoPeople();
    const samView = t.env.broadcaster.lastState(samId).view;
    must(await t.env.service.setConnected(code, samId, false));

    let state = await t.state(code);
    expect(state?.players.find((p) => p.id === samId)).toMatchObject({ botControlled: true, connected: true });
    expect(t.env.broadcaster.noticesTo(hostId)).toContainEqual(expect.objectContaining({ kind: "bot_takeover", playerId: samId, name: "Sam" }));
    const hostSees = t.env.broadcaster.lastState(hostId).view.players.find((p) => p.id === samId);
    expect(hostSees).toMatchObject({ botPlaying: true, isBot: false, connected: true });
    expect(t.bots.seatIds(code)).toContain(samId);
    const got = t.bots.received(code, samId);
    expect(got?.view).toEqual(t.env.broadcaster.lastState(samId).view);
    expect(got?.view?.you?.role).toBe(samView.you?.role);
    expect(got?.view?.you?.teammateIds).toEqual(samView.you?.teammateIds);

    // The bot plays Sam's seat: it acknowledges the role, and keeps going.
    await t.runUntil(code, async () => {
      const s = await t.state(code);
      return !s || s.phase === "GAME_OVER" || t.moves.filter((m) => m.seat === samId).length >= 2;
    });
    expect(t.moves.some((m) => m.seat === samId && m.type === "ACK_ROLE")).toBe(true);

    state = await t.state(code);
    if (state?.phase === "GAME_OVER") return;
    const sam = state?.players.find((p) => p.id === samId);
    if (!sam?.alive) return;

    // Sam is back.
    must(await t.env.service.setConnected(code, samId, true));
    state = await t.state(code);
    expect(state?.players.find((p) => p.id === samId)?.botControlled).toBe(false);
    expect(t.env.broadcaster.noticesTo(hostId)).toContainEqual(expect.objectContaining({ kind: "bot_released", playerId: samId }));
    expect(t.env.broadcaster.lastState(hostId).view.players.find((p) => p.id === samId)?.botPlaying).toBe(false);
    expect(t.bots.seatIds(code)).not.toContain(samId);
    expect(t.bots.received(code, samId)).toBeNull();
    const backAt = t.env.clock.now;
    await t.runUntil(code, async () => (await t.state(code))?.phase === "GAME_OVER");
    expect(t.moves.filter((m) => m.seat === samId && m.at > backAt)).toEqual([]);
    expect(warnings(t)).toEqual([]);
  });

  it("passes hosting to a person when the host is away", async () => {
    const { t, code, hostId, samId } = await twoPeople();
    must(await t.env.service.setConnected(code, hostId, false));
    const state = await t.state(code);
    expect(state?.hostId).toBe(samId);
    expect(state?.players.find((p) => p.id === hostId)?.botControlled).toBe(true);
  });

  it("also plays for someone who leaves mid-game", async () => {
    const { t, code, samId } = await twoPeople();
    must(await t.env.service.leave(code, samId));
    expect((await t.state(code))?.players.find((p) => p.id === samId)?.botControlled).toBe(true);
  });

  it("doesn't happen when the host turns it off, or in the lobby", async () => {
    const off = await twoPeople({ botTakeover: false });
    must(await off.t.env.service.setConnected(off.code, off.samId, false));
    expect((await off.t.state(off.code))?.players.find((p) => p.id === off.samId)).toMatchObject({ botControlled: false, connected: false });
    expect(off.t.bots.seatIds(off.code)).not.toContain(off.samId);

    const t = botTable(13);
    const { code } = await t.room(1);
    const sam = must(await t.env.service.joinRoom(code, "Sam", AVATAR));
    must(await t.env.service.setConnected(code, sam.playerId, false));
    expect((await t.state(code))?.players.find((p) => p.id === sam.playerId)?.botControlled).toBe(false);
  });
});

// ---------------------------------------------------------------- how bots think

describe("bot reasoning", () => {
  const steady = () => 0.5;

  it("never lets the Mafia pick a teammate, and goes along with a human teammate's pick", () => {
    const g = gameWithRoles(R8);
    g.nightAct("p1", "p6");
    const view = getGameView(g.state, "p2");
    for (let i = 0; i < 50; i++) {
      const r = mulberry(i);
      const choice = chooseNight(newMind(), view, "normal", r);
      expect(choice?.targetId).not.toBe("p1");
    }
    const picks = Array.from({ length: 40 }, (_, i) => chooseNight(newMind(), view, "normal", mulberry(i))?.targetId);
    expect(picks.filter((p) => p === "p6").length).toBeGreaterThan(30);
  });

  it("protects someone other than last night's choice", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p2", "p5");
    g.nightAct("p1", "p6");
    g.nightAct("p3", "p4");
    if (g.phase === "NIGHT") g.endPhase();
    g.advanceTo("NIGHT");
    expect(g.state.round).toBe(2);
    const view = getGameView(g.state, "p2");
    for (let i = 0; i < 30; i++) {
      const choice = chooseNight(newMind(), view, "normal", mulberry(i));
      expect(choice?.targetId).not.toBe("p5");
      expect(view.you?.nightAction?.validTargetIds).toContain(choice?.targetId);
    }
  });

  it("investigates someone not checked yet", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p3", "p4");
    g.nightAct("p1", "p6");
    if (g.phase === "NIGHT") g.endPhase();
    g.advanceTo("NIGHT");
    expect(g.state.round).toBe(2);
    const view = getGameView(g.state, "p3");
    for (let i = 0; i < 30; i++) {
      const choice = chooseNight(newMind(), view, "normal", mulberry(i));
      expect(choice?.targetId).not.toBe("p4");
      expect(choice?.targetId).not.toBe("p3");
    }
  });

  it("suspects the players accused in chat and votes for them", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p1", "p6");
    g.advanceTo("VOTING");
    const view = getGameView(g.state, "p5");
    const chat: ChatMessage[] = ["p2", "p3", "p4", "p7"].map((id, i) => ({
      id: `m${i}`,
      channel: "public",
      senderId: id,
      senderName: `Player ${id.slice(1)}`,
      text: "I don't trust Player 1. Player 1 is in the Mafia!",
      sentAt: 0,
    }));
    const mind = observe(newMind(), view, chat, steady);
    const votes = Array.from({ length: 20 }, (_, i) => chooseVote(mind, view, "normal", mulberry(i)));
    expect(votes.filter((v) => v === "p1").length).toBeGreaterThan(10);
  });

  it("picks at random on Easy", () => {
    const g = gameWithRoles(R7);
    g.nightAct("p1", "p6");
    g.advanceTo("VOTING");
    const view = getGameView(g.state, "p5");
    const votes = new Set(Array.from({ length: 40 }, (_, i) => chooseVote(newMind(), view, "easy", mulberry(i))));
    expect(votes.size).toBeGreaterThan(2);
  });
});

/** A tiny seeded random for the reasoning tests. */
function mulberry(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- what bots say

describe("bot lines and names", () => {
  it("have no emoji, and Safe Mode's lines pass the Safe Mode word list", () => {
    for (const mode of ["safe", "normal"] as ContentMode[]) {
      for (const lines of Object.values(BOT_LINES[mode])) {
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          for (const gang of ["Mafia", "Sneaky Gang"]) {
            const text = fillLine(line, { name: "Alex", gang });
            expect(text).not.toMatch(EMOJI);
            expect(text).not.toMatch(/[{}]/);
            expect(findBannedWord(text, mode), text).toBeNull();
            if (mode === "safe") expect(findBannedWord(text, "safe"), text).toBeNull();
          }
        }
      }
    }
  });

  it("are valid, distinct nicknames, and a free one is always found", () => {
    expect(new Set(BOT_NAMES.map((n) => n.toLowerCase())).size).toBe(BOT_NAMES.length);
    for (const name of BOT_NAMES) {
      expect(validateNickname(name).ok, name).toBe(true);
      expect(findBannedWord(name, "safe")).toBeNull();
      expect(name).not.toMatch(EMOJI);
    }
    const taken = BOT_NAMES.slice(0, -1);
    expect(freeBotName(taken, () => 0)).toBe(BOT_NAMES.at(-1));
    const all = [...BOT_NAMES];
    const extra = freeBotName(all, () => 0);
    expect(all.map((n) => n.toLowerCase())).not.toContain(extra.toLowerCase());
    expect(validateNickname(extra).ok).toBe(true);
  });
});
