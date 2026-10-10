/**
 * Runs every bot seat. It is a BotSink: the room service hands it exactly the
 * payloads it sends each bot seat's socket (game:state, chat, chat history),
 * and nothing else. It acts only through the BotPort, i.e. the same validated
 * player actions a human sends. It has no access to the room store or the
 * server's game state (see port.ts; a test checks the imports).
 *
 * Bots take their time like people do: a random 4–15 s before a night action
 * or a vote, a few seconds to get ready or acknowledge a role, and a handful
 * of chat lines spread over the day, so nobody can tell who has a night role
 * from how quickly a phase ends.
 */
import {
  BOT_DIFFICULTIES,
  SKIP,
  gangName,
  type BotDifficulty,
  type ChatHistoryPayload,
  type ChatMessage,
  type GameStatePayload,
  type GameView,
} from "@mafia/shared";
import type { Logger } from "../logger.js";
import { chooseNight, chooseVote, dayRemarks, living, mafiaSuggestion, me, newMind, observe, playerName, type Mind, type Random, type Remark } from "./brain.js";
import { BOT_LINES, fillLine, type LineKind } from "./lines.js";
import type { BotAction, BotPort, BotSink } from "./port.js";

export type Range = readonly [min: number, max: number];

export interface BotManagerOptions {
  port: BotPort;
  logger: Logger;
  /** The server's clock (the same one the rooms use). */
  now?: () => number;
  random?: Random;
  /** Wait before a night action or a vote (ms). Varied every time. */
  thinkDelay?: Range;
  /** Wait before getting ready or acknowledging a role (ms). */
  quickDelay?: Range;
  /** How often the manager looks for things that are due (ms). */
  tickMs?: number;
  /** Chat lines all bots in one room may post per phase, together. */
  roomLinesPerPhase?: number;
}

type PlanKind = "ready" | "ack" | "night" | "mafiaChat" | "say" | "done" | "vote" | "sayVote";

interface Plan {
  kind: PlanKind;
  due: number;
  phaseKey: string;
  remark?: Remark;
}

interface Seat {
  code: string;
  id: string;
  view: GameView | null;
  chat: ChatMessage[];
  mind: Mind;
  phaseKey: string;
  plans: Plan[];
}

const MAX_CHAT = 200;

function phaseKeyOf(view: GameView): string {
  return `${view.gameNumber}:${view.phase}:${view.round}:${view.voting?.round ?? 0}`;
}

export class BotManager implements BotSink {
  private readonly seats = new Map<string, Seat>();
  private readonly roomLines = new Map<string, { phaseKey: string; count: number }>();
  private readonly port: BotPort;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly random: Random;
  private readonly thinkDelay: Range;
  private readonly quickDelay: Range;
  private readonly roomLinesPerPhase: number;
  private readonly tickMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(options: BotManagerOptions) {
    this.port = options.port;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.thinkDelay = options.thinkDelay ?? [4000, 15000];
    this.quickDelay = options.quickDelay ?? [1500, 6000];
    this.roomLinesPerPhase = options.roomLinesPerPhase ?? 6;
    this.tickMs = options.tickMs ?? 500;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  // ------------------------------------------------------------ BotSink: what a bot seat receives

  state(code: string, id: string, payload: GameStatePayload): void {
    const seat = this.seat(code, id);
    seat.view = payload.view;
    this.think(seat);
  }

  chat(code: string, id: string, message: ChatMessage): void {
    const seat = this.seat(code, id);
    if (seat.chat.some((m) => m.id === message.id)) return;
    seat.chat = [...seat.chat.slice(-(MAX_CHAT - 1)), message];
    this.think(seat);
  }

  chatHistory(code: string, id: string, payload: ChatHistoryPayload): void {
    const seat = this.seat(code, id);
    seat.chat = payload.messages.slice(-MAX_CHAT);
    this.think(seat);
  }

  release(code: string, id: string): void {
    this.seats.delete(`${code}:${id}`);
  }

  /** Seats being played, for tests and the logs. */
  seatIds(code: string): string[] {
    return [...this.seats.values()].filter((s) => s.code === code).map((s) => s.id);
  }

  /** When the next planned move is due (tests use it to move time forward). */
  nextDue(): number | null {
    let next: number | null = null;
    for (const seat of this.seats.values()) for (const plan of seat.plans) if (next === null || plan.due < next) next = plan.due;
    return next;
  }

  /** What one bot seat has received: its own view and the chat it may read. Only used by tests. */
  received(code: string, id: string): { view: GameView | null; chat: readonly ChatMessage[] } | null {
    const seat = this.seats.get(`${code}:${id}`);
    return seat ? { view: seat.view, chat: seat.chat } : null;
  }

  private seat(code: string, id: string): Seat {
    const key = `${code}:${id}`;
    let seat = this.seats.get(key);
    if (!seat) {
      seat = { code, id, view: null, chat: [], mind: newMind(), phaseKey: "", plans: [] };
      this.seats.set(key, seat);
    }
    return seat;
  }

  // ------------------------------------------------------------ planning

  private rand(range: Range): number {
    const [min, max] = range;
    return min + this.random() * Math.max(0, max - min);
  }

  /** A human-like wait, kept inside the time the phase has left. */
  private delay(view: GameView, range: Range): number {
    const wanted = this.rand(range);
    const left =
      view.paused !== null ? Infinity : view.phaseEndsAt === null ? Infinity : view.phaseEndsAt - this.now();
    const latest = left - 1500;
    if (wanted <= latest) return wanted;
    return Math.max(300, latest * (0.4 + 0.5 * this.random()));
  }

  private difficulty(view: GameView, standIn: boolean): BotDifficulty {
    const d = view.settings.botDifficulty;
    if (standIn) return "normal";
    return (BOT_DIFFICULTIES as readonly string[]).includes(d) ? d : "normal";
  }

  /** Takes in what just arrived and plans what to do in this phase (once per phase). */
  private think(seat: Seat): void {
    const view = seat.view;
    const you = view?.you;
    if (!view || !you) return;
    const self = me(view);
    if (!self || (!self.isBot && !self.botPlaying)) {
      // Not a bot seat any more (its player is back): let go.
      this.release(seat.code, seat.id);
      return;
    }
    seat.mind = observe(seat.mind, view, seat.chat, this.random);
    const key = phaseKeyOf(view);
    if (key === seat.phaseKey) return;
    seat.phaseKey = key;
    seat.plans = [];

    const now = this.now();
    const standIn = self.botPlaying;
    const difficulty = this.difficulty(view, standIn);
    const add = (kind: PlanKind, wait: number, remark?: Remark) => seat.plans.push({ kind, due: now + wait, phaseKey: key, remark });

    switch (view.phase) {
      case "LOBBY":
        if (!self.done) add("ready", this.rand([500, 2500]));
        break;
      case "ROLE_REVEAL":
        if (!self.done) add("ack", this.delay(view, this.quickDelay));
        break;
      case "NIGHT": {
        if (!self.alive || !you.nightAction) break;
        const wait = this.delay(view, this.thinkDelay);
        add("night", wait);
        // Tell human teammates in the Mafia chat who this bot wants, before it picks.
        const humanTeammate = view.players.some((p) => you.teammateIds.includes(p.id) && p.alive && !p.isBot && !p.botPlaying);
        if (!standIn && you.nightAction.kind === "kill" && humanTeammate) add("mafiaChat", Math.max(200, wait * (0.3 + 0.3 * this.random())));
        break;
      }
      case "DAY_DISCUSSION": {
        if (!self.alive) break;
        const left = view.phaseEndsAt !== null ? Math.max(0, view.phaseEndsAt - now) : 60_000;
        if (!standIn) {
          for (const remark of dayRemarks(seat.mind, view, difficulty, this.random)) {
            add("say", Math.max(2500, left * (0.08 + 0.6 * this.random())), remark);
          }
        }
        const doneAt = difficulty === "easy" ? 0.3 + 0.6 * this.random() : 0.55 + 0.35 * this.random();
        add("done", Math.max(3000, left * doneAt));
        break;
      }
      case "VOTING": {
        if (!self.alive || !view.voting || view.voting.validTargetIds.length === 0) break;
        const wait = this.delay(view, this.thinkDelay);
        add("vote", wait);
        if (!standIn && difficulty === "normal" && this.random() < 0.35) add("sayVote", wait + this.rand([1000, 4000]));
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------ acting

  /** Does everything that is due. Safe to call often; one pass at a time. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      for (const seat of [...this.seats.values()]) {
        const due = seat.plans.filter((p) => p.due <= now).sort((a, b) => a.due - b.due);
        if (due.length === 0) continue;
        seat.plans = seat.plans.filter((p) => p.due > now);
        for (const plan of due) {
          if (plan.phaseKey !== seat.phaseKey || !this.seats.has(`${seat.code}:${seat.id}`)) continue;
          await this.run(seat, plan).catch((err: unknown) => this.logger.error("bot.failed", { room: seat.code }, err));
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async act(seat: Seat, action: BotAction): Promise<void> {
    const result = await this.port.botAct(seat.code, seat.id, action);
    // No seat id next to the code: a rejection could hint at the seat's role.
    if (!result.ok && result.error.code !== "ROOM_NOT_FOUND") {
      this.logger.warn("bot.action_rejected", { room: seat.code, action: action.type, code: result.error.code });
    }
  }

  private async say(seat: Seat, view: GameView, kind: LineKind, about?: string): Promise<void> {
    const key = phaseKeyOf(view);
    const used = this.roomLines.get(seat.code);
    const count = used && used.phaseKey === key ? used.count : 0;
    if (count >= this.roomLinesPerPhase) return;
    const lines = BOT_LINES[view.settings.contentMode][kind];
    const line = lines[Math.floor(this.random() * lines.length)];
    if (!line) return;
    const text = fillLine(line, { name: playerName(view, about), gang: gangName(view.settings) });
    this.roomLines.set(seat.code, { phaseKey: key, count: count + 1 });
    await this.port.botChat(seat.code, seat.id, text);
  }

  private async run(seat: Seat, plan: Plan): Promise<void> {
    const view = seat.view;
    const you = view?.you;
    const self = view ? me(view) : undefined;
    if (!view || !you || !self) return;
    const difficulty = this.difficulty(view, self.botPlaying);

    switch (plan.kind) {
      case "ready":
        if (view.phase === "LOBBY" && !self.done) await this.act(seat, { type: "SET_READY", ready: true });
        return;
      case "ack":
        if (view.phase === "ROLE_REVEAL" && !self.done) await this.act(seat, { type: "ACK_ROLE" });
        return;
      case "mafiaChat": {
        const target = mafiaSuggestion(seat.mind, view, this.random);
        if (!target || view.phase !== "NIGHT") return;
        seat.mind.teamSuggestion = { round: view.round, targetId: target, fromHuman: false };
        await this.say(seat, view, "mafiaPlan", target);
        return;
      }
      case "night": {
        const action = you.nightAction;
        const needed = action?.kind === "link" ? 2 : 1;
        if (view.phase !== "NIGHT" || !action || action.picks.length >= needed) return;
        const choice = chooseNight(seat.mind, view, difficulty, this.random);
        if (!choice) return;
        await this.act(seat, { type: "NIGHT_ACTION", ...choice });
        return;
      }
      case "say":
        if (view.phase === "DAY_DISCUSSION" && self.alive && plan.remark) await this.say(seat, view, plan.remark.kind, plan.remark.about);
        return;
      case "done":
        if (view.phase === "DAY_DISCUSSION" && self.alive && view.discussion && !view.discussion.youAreDone) {
          await this.act(seat, { type: "SKIP_DISCUSSION", skip: true });
        }
        return;
      case "vote": {
        if (view.phase !== "VOTING" || !view.voting || view.voting.myBallot !== null) return;
        const target = chooseVote(seat.mind, view, difficulty, this.random);
        if (target !== null) await this.act(seat, { type: "CAST_VOTE", targetId: target });
        return;
      }
      case "sayVote": {
        const ballot = view.voting?.myBallot;
        if (view.phase === "VOTING" && ballot && ballot !== SKIP && living(view).some((p) => p.id === ballot)) {
          await this.say(seat, view, "agreeVote", ballot);
        }
        return;
      }
    }
  }
}
