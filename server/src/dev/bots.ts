/**
 * Development-only bots, so one person can play a whole game alone.
 *
 * A bot is an ordinary player: it joins through RoomService.joinRoom like a
 * browser would, and everything it does goes through the same service calls
 * (act, sendChat, sendReaction), so the engine's rules apply to it exactly as
 * to a human. It only differs in having no socket, and in deciding what to do
 * from its own personal view (getGameView), never from hidden state it
 * shouldn't know. Nothing here is loaded in production.
 */
import { AVATAR_COLORS, CHAT_REACTIONS, MAX_PLAYERS, SKIP, type Avatar, type DevFillBotsResult } from "@mafia/shared";
import { chatChannelFor, getGameView, type GameState, type Rng } from "../game/index.js";
import type { Logger } from "../logger.js";
import type { RoomStore } from "../rooms/roomStore.js";
import type { RoomService, ServiceResult } from "../rooms/roomService.js";

/** How many players "Fill with bots" aims for: enough for the extra roles. */
export const BOT_FILL_TARGET = 8;

const NAMES = ["Ada", "Bo", "Cy", "Dee", "Eve", "Finn", "Gus", "Hana", "Ivo", "Jun", "Kai", "Lia", "Max", "Nia", "Oz", "Pia", "Quin", "Rae", "Sol", "Tia"];

const DAY_LINES = [
  "Hmm, who seems quiet to you?",
  "I'm just a villager, I promise!",
  "Let's not vote too fast.",
  "I think {name} is acting a bit odd.",
  "Anyone have a hunch?",
  "{name}, what did you do last night?",
  "I trust {name}.",
  "Skip this round? I'm not sure yet.",
  "That was a close one!",
  "Who are we voting for?",
];
const NIGHT_LINES = ["Let's pick {name}.", "Not {name}, they seem too careful.", "Agreed. Stay calm.", "Quick and quiet tonight."];

export interface BotOptions {
  rng: Rng;
  /** How often the bots think, in ms. */
  intervalMs?: number;
  /** The chance a bot acts on a given think (spreads their actions out). */
  actChance?: number;
  /** The chance a bot chats on a given think when it may. */
  chatChance?: number;
}

export class BotManager {
  private readonly bots = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly rng: Rng;
  private readonly actChance: number;
  private readonly chatChance: number;

  constructor(
    private readonly service: RoomService,
    private readonly store: RoomStore,
    private readonly logger: Logger,
    private readonly options: BotOptions,
  ) {
    this.rng = options.rng;
    this.actChance = options.actChance ?? 0.5;
    this.chatChance = options.chatChance ?? 0.12;
  }

  /** Starts thinking on a timer. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.thinkAll(), this.options.intervalMs ?? 1500);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  botIds(code: string): string[] {
    return [...(this.bots.get(code) ?? [])];
  }

  /**
   * Adds bots to a lobby. Only the host asks, and only before the game starts.
   * With no count, fills the room up to BOT_FILL_TARGET players.
   */
  async addBots(code: string, hostId: string, count?: number): Promise<ServiceResult<DevFillBotsResult>> {
    const room = await this.store.get(code);
    if (!room) return fail("ROOM_NOT_FOUND", "That room doesn't exist.");
    const { state } = room;
    if (state.hostId !== hostId) return fail("NOT_HOST", "Only the host can add bots.");
    if (state.phase !== "LOBBY") return fail("WRONG_PHASE", "Bots can only join in the lobby.");
    const free = MAX_PLAYERS - state.players.length;
    const wanted = count === undefined ? Math.max(0, BOT_FILL_TARGET - state.players.length) : Math.floor(count);
    if (!Number.isFinite(wanted) || wanted < 0) return fail("BAD_REQUEST", "count must be a positive number.");
    const toAdd = Math.min(wanted, free);

    let added = 0;
    for (let i = 0; i < toAdd; i++) {
      // Look again each time: the previous bot's name is taken now.
      const current = (await this.store.get(code))?.state ?? state;
      const joined = await this.service.joinRoom(code, this.freeName(current), this.randomAvatar(), undefined, true);
      if (!joined.ok) {
        if (added === 0) return joined;
        break;
      }
      const set = this.bots.get(code) ?? new Set<string>();
      set.add(joined.value.playerId);
      this.bots.set(code, set);
      added += 1;
    }
    const players = (await this.store.get(code))?.state.players.length ?? 0;
    this.logger.info("dev.bots_added", { room: code, added, players });
    return ok({ added, players });
  }

  /** The first free "Bot <name>" in this room, in list order; numbered once the list is used up. */
  private freeName(state: GameState): string {
    const taken = new Set(state.players.map((p) => p.name.toLowerCase()));
    for (let round = 0; round < 10; round++) {
      for (const base of NAMES) {
        const name = `Bot ${base}${round > 0 ? ` ${round + 1}` : ""}`;
        if (!taken.has(name.toLowerCase())) return name;
      }
    }
    return `Bot ${taken.size + 1}`;
  }

  private randomAvatar(): Avatar {
    const color = AVATAR_COLORS[Math.floor(this.rng() * AVATAR_COLORS.length)] ?? "teal";
    let seed = "";
    for (let i = 0; i < 8; i++) seed += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(this.rng() * 36)];
    return { color, seed };
  }

  // ------------------------------------------------------------ thinking

  async thinkAll(): Promise<void> {
    for (const code of [...this.bots.keys()]) {
      try {
        await this.think(code);
      } catch (err) {
        this.logger.error("dev.bot_failed", { room: code }, err);
      }
    }
  }

  /** Every bot in a room looks at its own view and maybe does one thing. */
  async think(code: string): Promise<void> {
    const room = await this.store.get(code);
    if (!room) {
      this.bots.delete(code);
      return;
    }
    const ids = this.bots.get(code);
    if (!ids) return;
    for (const id of [...ids]) {
      const state = (await this.store.get(code))?.state ?? room.state;
      if (!state.players.some((p) => p.id === id && !p.kicked)) {
        ids.delete(id);
        continue;
      }
      await this.thinkOne(code, state, id);
    }
    if (ids.size === 0) this.bots.delete(code);
  }

  private pick<T>(items: readonly T[]): T | undefined {
    return items[Math.floor(this.rng() * items.length)];
  }

  private async thinkOne(code: string, state: GameState, id: string): Promise<void> {
    const view = getGameView(state, id);
    const me = view.players.find((p) => p.id === id);
    if (!me || !view.you) return;

    // Doing the phase's job comes first (a bot that is "done" has nothing left to do).
    if (this.rng() < this.actChance) {
      switch (state.phase) {
        case "LOBBY":
          // Bots are always ready, so the host's Start button lights up once the people are.
          if (!me.done) await this.service.act(code, { type: "SET_READY", playerId: id, ready: true });
          return;
        case "DAY_DISCUSSION":
          // Bots are happy to stop talking: the discussion ends early once the people are done too.
          if (me.alive && view.discussion && !view.discussion.youAreDone && this.rng() < 0.3) {
            await this.service.act(code, { type: "SKIP_DISCUSSION", playerId: id, skip: true });
            return;
          }
          break;
        case "ROLE_REVEAL":
          if (!me.done) await this.service.act(code, { type: "ACK_ROLE", playerId: id });
          return;
        case "NIGHT": {
          const action = view.you.nightAction;
          const needed = action?.kind === "link" ? 2 : 1;
          if (action && me.alive && action.picks.length < needed) {
            const [first, second] = this.shuffled(action.validTargetIds);
            if (first === undefined) return;
            if (action.kind === "link") {
              if (second === undefined) return;
              await this.service.act(code, { type: "NIGHT_ACTION", playerId: id, targetId: first, secondTargetId: second });
            } else {
              await this.service.act(code, { type: "NIGHT_ACTION", playerId: id, targetId: first });
            }
            return;
          }
          break;
        }
        case "VOTING": {
          const voting = view.voting;
          if (voting && me.alive && voting.myBallot === null) {
            const people = voting.validTargetIds.filter((t) => t !== SKIP && t !== id);
            const skip = voting.validTargetIds.includes(SKIP) && (people.length === 0 || this.rng() < 0.1);
            const target = skip ? SKIP : this.pick(people);
            if (target !== undefined) await this.service.act(code, { type: "CAST_VOTE", playerId: id, targetId: target });
            return;
          }
          break;
        }
        default:
          break;
      }
    }

    // Now and then, say something (or react) wherever the server lets this bot talk.
    if (this.rng() < this.chatChance && chatChannelFor(state, id) !== null) {
      if (this.rng() < 0.3) {
        const reaction = this.pick(CHAT_REACTIONS);
        if (reaction) await this.service.sendReaction(code, id, reaction);
        return;
      }
      const night = state.phase === "NIGHT";
      const others = state.players.filter((p) => p.id !== id && p.alive);
      const line = this.pick(night ? NIGHT_LINES : DAY_LINES) ?? "Hello!";
      const other = this.pick(others)?.name ?? "someone";
      await this.service.sendChat(code, id, line.replace("{name}", other));
    }
  }

  private shuffled<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = <T = never>(code: "ROOM_NOT_FOUND" | "NOT_HOST" | "WRONG_PHASE" | "BAD_REQUEST", message: string): ServiceResult<T> => ({
  ok: false,
  error: { code, message },
});
