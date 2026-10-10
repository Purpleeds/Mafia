/**
 * Runs every bot seat. It is a BotSink: the room service hands it exactly the
 * payloads it sends each bot seat's socket (game:state, chat, chat history),
 * the bot's own personality, and what was said in the public chat (heard
 * events, the same for every bot in the room). It acts only through the
 * BotPort: the same validated player actions a human sends, and messages the
 * service posts after a "typing…" pause. It has no access to the room store or
 * the server's game state (see port.ts; a test checks the imports).
 *
 * Bots take their time like people do: a random 4–15 s before a night action
 * or a vote, a few seconds to get ready or acknowledge a role, and a few chat
 * messages over the day (more for talkative bots), answering quickly when
 * someone asks or accuses them. Nobody can tell who has a night role from how
 * quickly a phase ends.
 */
import { BOT_DIFFICULTIES, SKIP, type BotDifficulty, type ChatHistoryPayload, type ChatMessage, type GameStatePayload, type GameView } from "@mafia/shared";
import type { Logger } from "../logger.js";
import { chooseNight, chooseVote, mafiaSuggestion, shouldChangeVote } from "./brain.js";
import type { Heard } from "./heard.js";
import { hear, living, me, newMind, observe, type Mind, type MindContext, type Random } from "./mind.js";
import { standInPersonality, type BotPersonality } from "./personality.js";
import type { BotAction, BotIntent, BotPort, BotSink } from "./port.js";
import { mafiaPlanLine, planSpeech, voteChangeLine, type SpeechContext } from "./strategy.js";

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
  /** Wait before answering someone who spoke to or accused the bot (ms): reading time. */
  replyDelay?: Range;
  /** How often the manager looks for things that are due (ms). */
  tickMs?: number;
}

type PlanKind = "ready" | "ack" | "night" | "mafiaChat" | "talk" | "done" | "vote" | "reconsider";

interface Plan {
  kind: PlanKind;
  due: number;
  phaseKey: string;
}

interface Seat {
  code: string;
  id: string;
  view: GameView | null;
  chat: ChatMessage[];
  mind: Mind;
  personality: BotPersonality;
  phaseKey: string;
  plans: Plan[];
  /** Messages posted this phase on its own initiative, and answers to others. */
  spoken: number;
  replies: number;
  /** Waiting for its last message to be posted (the service is "typing" it). */
  waitingUntil: number;
  voteChanges: number;
}

const MAX_CHAT = 200;
/** Answers to being asked, accused or caught out, per phase (on top of its own messages). */
const MAX_REPLIES = 3;
/** How long a message may take to appear (typing plus the AI) before the bot stops waiting for it. */
const POST_WAIT_MS = 25_000;

/** The parts of a bot's memory that planning a message changes. */
function speechMemory(mind: Mind) {
  return structuredClone({
    talk: mind.talk,
    announced: mind.announced,
    calledOut: mind.calledOut,
    questions: mind.questions,
    said: mind.said,
    reactedTo: mind.reactedTo,
    fakeDetective: mind.fakeDetective,
  });
}

function restoreSpeechMemory(mind: Mind, saved: ReturnType<typeof speechMemory>): void {
  // Questions asked meanwhile (while the message was being sent) are kept.
  const newer = mind.questions.filter((q) => !saved.questions.some((s) => s.messageId === q.messageId));
  Object.assign(mind, saved);
  mind.questions = [...saved.questions, ...newer];
}

function phaseKeyOf(view: GameView): string {
  return `${view.gameNumber}:${view.phase}:${view.round}:${view.voting?.round ?? 0}`;
}

function talking(view: GameView): boolean {
  return view.phase === "DAY_DISCUSSION" || view.phase === "VOTING";
}

/** How many messages a bot says of its own accord in a phase: talkative bots more. */
export function talkBudget(personality: BotPersonality, view: GameView): number {
  if (view.phase === "DAY_DISCUSSION") return 1 + Math.round(personality.talkativeness * 3);
  if (view.phase === "VOTING") return personality.talkativeness > 0.55 ? 2 : 1;
  return 0;
}

export class BotManager implements BotSink {
  private readonly seats = new Map<string, Seat>();
  private readonly port: BotPort;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly random: Random;
  private readonly thinkDelay: Range;
  private readonly quickDelay: Range;
  private readonly replyDelay: Range;
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
    this.replyDelay = options.replyDelay ?? [1500, 4500];
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

  attach(code: string, id: string, personality: BotPersonality): void {
    this.seat(code, id).personality = personality;
  }

  state(code: string, id: string, payload: GameStatePayload): void {
    const seat = this.seat(code, id);
    seat.view = payload.view;
    this.think(seat);
  }

  chat(code: string, id: string, message: ChatMessage): void {
    const seat = this.seat(code, id);
    if (seat.chat.some((m) => m.id === message.id)) return;
    seat.chat = [...seat.chat.slice(-(MAX_CHAT - 1)), message];
    if (message.senderId === id) seat.waitingUntil = 0;
    this.think(seat);
  }

  chatHistory(code: string, id: string, payload: ChatHistoryPayload): void {
    const seat = this.seat(code, id);
    seat.chat = payload.messages.slice(-MAX_CHAT);
    this.think(seat);
  }

  heard(code: string, events: readonly Heard[]): void {
    for (const seat of this.seats.values()) {
      if (seat.code !== code || !seat.view?.you) continue;
      const view = seat.view;
      const result = hear(seat.mind, this.mindContext(seat, view), events);
      if (events.some((e) => e.speakerId === seat.id)) seat.waitingUntil = 0;
      const self = me(view);
      if (!self?.alive || !talking(view)) continue;
      const now = this.now();
      if (!self.botPlaying && (result.questioned || result.accused || result.noticed)) {
        this.scheduleTalk(seat, now + this.rand(this.replyDelay));
      } else if (!self.botPlaying && result.persuaded && this.random() < 0.25 + 0.4 * seat.personality.talkativeness) {
        this.scheduleTalk(seat, now + this.rand([3000, 9000]));
      }
      if (result.persuaded && view.phase === "VOTING" && view.voting?.myBallot) {
        this.schedule(seat, "reconsider", now + this.rand([2000, 6000]));
      }
    }
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

  /** What one bot seat has received and remembers. Only used by tests. */
  received(code: string, id: string): { view: GameView | null; chat: readonly ChatMessage[]; mind: Mind; personality: BotPersonality } | null {
    const seat = this.seats.get(`${code}:${id}`);
    return seat ? { view: seat.view, chat: seat.chat, mind: seat.mind, personality: seat.personality } : null;
  }

  private seat(code: string, id: string): Seat {
    const key = `${code}:${id}`;
    let seat = this.seats.get(key);
    if (!seat) {
      seat = {
        code,
        id,
        view: null,
        chat: [],
        mind: newMind(),
        personality: standInPersonality(),
        phaseKey: "",
        plans: [],
        spoken: 0,
        replies: 0,
        waitingUntil: 0,
        voteChanges: 0,
      };
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
    const left = view.paused !== null ? Infinity : view.phaseEndsAt === null ? Infinity : view.phaseEndsAt - this.now();
    const latest = left - 1500;
    if (wanted <= latest) return wanted;
    return Math.max(300, latest * (0.4 + 0.5 * this.random()));
  }

  private difficulty(view: GameView, standIn: boolean): BotDifficulty {
    const d = view.settings.botDifficulty;
    if (standIn) return "normal";
    return (BOT_DIFFICULTIES as readonly string[]).includes(d) ? d : "normal";
  }

  private mindContext(seat: Seat, view: GameView): MindContext {
    const self = me(view);
    return { view, personality: seat.personality, difficulty: this.difficulty(view, self?.botPlaying ?? false), random: this.random };
  }

  private schedule(seat: Seat, kind: PlanKind, due: number): void {
    const existing = seat.plans.find((p) => p.kind === kind && p.phaseKey === seat.phaseKey);
    if (existing) {
      existing.due = Math.min(existing.due, due);
      return;
    }
    seat.plans.push({ kind, due, phaseKey: seat.phaseKey });
  }

  private scheduleTalk(seat: Seat, due: number): void {
    this.schedule(seat, "talk", due);
  }

  /** The next time a bot looks for something to say: soon for talkative bots, rarely for quiet ones. */
  private nextTalk(seat: Seat, view: GameView): void {
    if (seat.spoken >= talkBudget(seat.personality, view)) return;
    const t = seat.personality.talkativeness;
    const gap = (24_000 - 16_000 * t) * (0.6 + 0.8 * this.random());
    const left = view.phaseEndsAt !== null && view.paused === null ? view.phaseEndsAt - this.now() : Infinity;
    if (gap > left - 2000) return;
    this.scheduleTalk(seat, this.now() + gap);
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
    const ctx = this.mindContext(seat, view);
    const noticed = observe(seat.mind, ctx, seat.chat);
    const key = phaseKeyOf(view);
    if (key === seat.phaseKey) {
      if (noticed > 0 && !self.botPlaying && self.alive && talking(view)) this.scheduleTalk(seat, this.now() + this.rand(this.replyDelay));
      return;
    }
    seat.phaseKey = key;
    seat.plans = [];
    seat.spoken = 0;
    seat.replies = 0;
    seat.voteChanges = 0;
    seat.waitingUntil = 0;

    const now = this.now();
    const standIn = self.botPlaying;
    const add = (kind: PlanKind, wait: number) => seat.plans.push({ kind, due: now + wait, phaseKey: key });

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
          const t = seat.personality.talkativeness;
          const first = (18_000 - 13_000 * t) * (0.6 + 0.8 * this.random());
          add("talk", Math.max(2500, Math.min(first, left * 0.5)));
        }
        const difficulty = this.difficulty(view, standIn);
        const doneAt = difficulty === "easy" ? 0.3 + 0.6 * this.random() : 0.55 + 0.35 * this.random();
        add("done", Math.max(3000, left * doneAt));
        break;
      }
      case "VOTING": {
        if (!self.alive || !view.voting || view.voting.validTargetIds.length === 0) break;
        const wait = this.delay(view, this.thinkDelay);
        add("vote", wait);
        break;
      }
      default:
        break;
    }
    // Anything already waiting (a question asked during the night results) gets an answer.
    if (!standIn && self.alive && talking(view) && (seat.mind.questions.length > 0 || noticed > 0)) {
      this.scheduleTalk(seat, now + this.rand(this.replyDelay));
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

  /** Queues a message. "taken": it will be posted. "dropped": not now, and not worth trying again. */
  private async say(seat: Seat, intent: BotIntent): Promise<"taken" | "dropped" | "retry"> {
    const result = await this.port.botSay(seat.code, seat.id, intent);
    if (result.ok) {
      seat.waitingUntil = this.now() + POST_WAIT_MS;
      return "taken";
    }
    // Busy rooms and closed chats are normal; anything else is worth knowing about.
    if (!["RATE_LIMITED", "CHAT_NOT_ALLOWED", "ROOM_NOT_FOUND", "NOT_IN_ROOM"].includes(result.error.code)) {
      this.logger.warn("bot.say_rejected", { room: seat.code, act: intent.act, code: result.error.code });
    }
    if (result.error.code !== "RATE_LIMITED") return "dropped";
    // An answer to another bot once the bots have gone back and forth enough, or a point someone already made: let it go.
    const replied = intent.replyToMessageId ? seat.chat.find((m) => m.id === intent.replyToMessageId) : undefined;
    const toBot = !!replied && !!seat.view?.players.some((p) => p.id === replied.senderId && p.isBot);
    const sharedPoint = intent.act === "call_out" || intent.act === "counter_claim" || intent.act === "react_death" || intent.act === "agree";
    return toBot || sharedPoint ? "dropped" : "retry";
  }

  private speechContext(seat: Seat, view: GameView): SpeechContext {
    const self = me(view);
    return {
      mind: seat.mind,
      view,
      personality: seat.personality,
      difficulty: this.difficulty(view, self?.botPlaying ?? false),
      random: this.random,
      now: this.now(),
    };
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
        const teammatePick = Object.values(you.nightAction?.teammateVotes ?? {}).includes(target);
        seat.mind.teamSuggestion = { round: view.round, targetId: target, fromHuman: false };
        await this.say(seat, mafiaPlanLine(view, seat.personality, target, teammatePick, this.random));
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
      case "talk": {
        if (!talking(view) || !self.alive || self.botPlaying) return;
        const now = this.now();
        if (seat.waitingUntil > now) {
          // Still "typing" the last one: look again once it's out.
          this.scheduleTalk(seat, Math.min(seat.waitingUntil, now + 3000));
          return;
        }
        const free = seat.spoken < talkBudget(seat.personality, view);
        // Planning marks things as said (a result announced, a question answered): undone if the message isn't taken.
        const before = speechMemory(seat.mind);
        const planned = planSpeech(this.speechContext(seat, view), free);
        let outcome: "taken" | "dropped" | "retry" = "retry";
        if (planned) {
          const asReply = planned.urgent && seat.replies < MAX_REPLIES;
          if (asReply || free) {
            outcome = await this.say(seat, planned.intent);
            if (outcome === "taken") {
              if (asReply) seat.replies++;
              else seat.spoken++;
            }
          }
        }
        if (outcome === "retry") restoreSpeechMemory(seat.mind, before);
        this.nextTalk(seat, view);
        return;
      }
      case "done":
        if (view.phase === "DAY_DISCUSSION" && self.alive && view.discussion && !view.discussion.youAreDone) {
          await this.act(seat, { type: "SKIP_DISCUSSION", skip: true });
        }
        return;
      case "vote": {
        if (view.phase !== "VOTING" || !view.voting || view.voting.myBallot !== null) return;
        const target = chooseVote(seat.mind, view, difficulty, this.random, seat.personality);
        if (target !== null) await this.act(seat, { type: "CAST_VOTE", targetId: target });
        if (!self.botPlaying) this.scheduleTalk(seat, this.now() + this.rand([1500, 5000]));
        return;
      }
      case "reconsider": {
        const ballot = view.voting?.myBallot;
        if (view.phase !== "VOTING" || !view.voting || !ballot || seat.voteChanges >= 2) return;
        const next = chooseVote(seat.mind, view, difficulty, this.random, seat.personality, { reconsider: true });
        if (next === null || !shouldChangeVote(seat.mind, view, seat.personality, ballot, next)) return;
        if (!view.voting.validTargetIds.includes(next)) return;
        seat.voteChanges++;
        await this.act(seat, { type: "CAST_VOTE", targetId: next });
        if (!self.botPlaying && next !== SKIP && living(view).some((p) => p.id === next) && seat.spoken < talkBudget(seat.personality, view) + 1) {
          if ((await this.say(seat, voteChangeLine(this.speechContext(seat, view), next))) === "taken") seat.spoken++;
        }
        return;
      }
    }
  }
}
