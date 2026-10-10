import { randomUUID } from "node:crypto";
import {
  BOT_LINE_MAX_LENGTH,
  BOT_LISTEN_BATCH,
  BOT_LISTEN_INTERVAL_MS,
  BOT_LISTEN_TIMEOUT_MS,
  BOT_REPLY_CHAIN_LIMIT,
  BOT_SPEECH_BATCH,
  BOT_SPEECH_MIN_INTERVAL_MS,
  BOT_SPEECH_TIMEOUT_MS,
  CONTRADICTION_KINDS,
  QUESTION_TOPICS,
  ROLES,
  SPEECH_ACTS,
  SPEECH_REASONS,
  SPEECH_TONES,
  containsLink,
  gangName,
  type BotListenRequestPayload,
  type BotSpeechRequestPayload,
  type ChatChannel,
  type ChatMessage,
  type ErrorCode,
  type GameView,
  type LogEntryView,
  type SpeechIntent,
} from "@mafia/shared";
import { chatChannelFor, getGameView, type GameState } from "../game/index.js";
import type { Logger } from "../logger.js";
import { heardFromIntent, parseMessage, validateAiHeard, type Heard, type HeardSource, type NamedPlayer } from "../bots/heard.js";
import { styleDescription } from "../bots/personality.js";
import type { BotIntent } from "../bots/port.js";
import { checkBotLine } from "../narration/botChecks.js";
import { sanitizeChatText } from "./chatRules.js";
import type { Scheduler } from "./scheduler.js";
import type { Room } from "./types.js";

/**
 * Bots talking, on the server's side: a queue of messages per room, "typing…"
 * while each one is written, and the host's AI when the host has it on.
 *
 * THE GOLDEN RULE: everything sent to the host's browser for its AI is built
 * here from public information only: the game as an outsider sees it (no
 * viewer, so no role, team or night action), the public chat, the bots'
 * intents (public by construction) and their speaking styles. The Mafia chat
 * never goes to the AI: those lines are always ready-made.
 *
 * Writing: intents wait a moment to be batched (one AI call per room every
 * 6 s at most); whatever the AI writes is checked (checkBotLine) and replaced
 * by the ready-made line if it fails, or if the AI doesn't answer in time.
 * Messages appear after a typing delay that grows with their length.
 *
 * Reading: people's public messages are sent to the AI in small batches (one
 * call every 4 s at most) and the answer is validated (validateAiHeard). With
 * the AI off, or no answer, the keyword parser reads them instead.
 *
 * Bots reply to each other at most BOT_REPLY_CHAIN_LIMIT times in a row: after
 * that they wait until a person speaks (or the next phase).
 */
export interface TalkHost {
  clock(): number;
  random(): number;
  scheduler: Scheduler;
  logger: Logger;
  /** Runs work under the room's lock. */
  withRoom(code: string, task: (room: Room) => Promise<void>): Promise<void>;
  /** Posts a bot's message through the normal chat rules (inside the lock). */
  post(room: Room, botId: string, text: string): Promise<ChatMessage | null>;
  /** Hands what was said to every bot in the room. */
  heard(room: Room, events: Heard[]): void;
  typing(room: Room, botId: string, channel: ChatChannel, typing: boolean): void;
  speechRequest(room: Room, hostId: string, payload: BotSpeechRequestPayload): void;
  listenRequest(room: Room, hostId: string, payload: BotListenRequestPayload): void;
}

export type TalkResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

interface QueuedLine {
  key: string;
  botId: string;
  intent: BotIntent;
  channel: ChatChannel;
  typingSince: number;
  status: "waiting" | "asking" | "ready";
  text: string | null;
  postAt: number;
  /** It answers a bot's message (counts toward the reply chain). */
  replyToBot: boolean;
}

interface TalkRoom {
  lines: QueuedLine[];
  speech: { requestId: string; keys: string[]; deadline: number; intents: Map<string, SpeechIntent> } | null;
  lastSpeechAt: number;
  /** Bot replies to bots since a person last spoke. */
  chain: number;
  posted: number;
  phase: string;
  aiFailures: number;
  aiPausedUntil: number;
  /** How often each topic was raised this phase (so three bots don't call out the same lie). */
  topics: Map<string, number>;
  pending: ChatMessage[];
  listen: { requestId: string; batch: Array<{ n: number; message: HeardSource }>; deadline: number } | null;
  lastListenAt: number;
}

const MAX_QUEUE = 8;
const BATCH_WAIT_MS = 1200;
const LISTEN_WAIT_MS = 1500;
const CHAT_CONTEXT = 10;

/** Things one bot saying is enough: the same call-out, the same condolence... (per phase). */
function topicOf(intent: BotIntent): { key: string; limit: number } | null {
  switch (intent.act) {
    case "call_out":
      return { key: `call_out:${intent.targetId}:${intent.contradiction}`, limit: 1 };
    case "counter_claim":
      return { key: `counter_claim:${intent.targetId}`, limit: 1 };
    case "react_death":
      return { key: `react_death:${intent.targetId}`, limit: 1 };
    case "agree":
      return { key: `agree:${intent.targetId}`, limit: 2 };
    default:
      return null;
  }
}

const ok = (): TalkResult => ({ ok: true });
const no = (code: ErrorCode, message: string): TalkResult => ({ ok: false, code, message });

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/** A human-looking typing time: longer for longer messages. */
export function typingMs(text: string, random: () => number): number {
  const base = Math.min(7000, Math.max(1500, 800 + 45 * [...text].length));
  return base * (0.85 + 0.35 * random());
}

/** How many bot lines a room may post in a phase. */
function phaseCap(state: GameState): number {
  const t = state.settings.timers;
  if (state.phase === "DAY_DISCUSSION") return Math.max(6, Math.min(30, Math.round(t.discussionSeconds / 5)));
  if (state.phase === "VOTING") return Math.max(3, Math.min(12, Math.round(t.votingSeconds / 6)));
  return 6;
}

const phaseKey = (state: GameState) => `${state.gameNumber}:${state.phase}:${state.round}`;

/** Living phases where people talk in public (and bots listen). */
function publicTalkPhase(state: GameState): boolean {
  return state.phase === "DAY_DISCUSSION" || state.phase === "VOTING" || state.phase === "NIGHT_RESULTS" || state.phase === "VOTE_RESULTS";
}

function namedPlayers(state: GameState): NamedPlayer[] {
  return state.players.filter((p) => !p.kicked).map((p) => ({ id: p.id, name: p.name }));
}

/** The game as an outsider sees it: no viewer, so nothing private. Everything the AI hears comes from this. */
export function publicView(state: GameState): GameView {
  return getGameView(state, "");
}

/** What everyone has seen happen, in plain sentences (a role only if it was revealed to everyone). */
export function describeEvents(view: GameView): string[] {
  const name = (id: string) => JSON.stringify(view.players.find((p) => p.id === id)?.name ?? "someone");
  const gang = gangName(view.settings);
  const safe = view.settings.contentMode === "safe";
  const roleText = (role: string | null) =>
    role ? ` (their role was revealed: ${role === "mafia" ? gang : role.charAt(0).toUpperCase() + role.slice(1)})` : "";
  const out: string[] = [];
  for (const entry of view.log as LogEntryView[]) {
    if (entry.kind === "night") {
      if (entry.deaths.length === 0) out.push(`Night ${entry.round}: nobody left the game${entry.saved ? " (someone was saved)" : ""}.`);
      for (const d of entry.deaths) {
        const how = d.cause === "heartbreak" ? "left with a broken heart" : safe ? "was sent home during the night" : "was taken in the night";
        out.push(`Night ${entry.round}: ${name(d.playerId)} ${how}${roleText(d.role)}.`);
      }
    } else if (entry.kind === "vote") {
      if (entry.deaths.length === 0) out.push(`Day ${entry.round} vote: nobody was voted out.`);
      for (const d of entry.deaths) {
        const how = d.cause === "heartbreak" ? "left with a broken heart" : "was voted out";
        out.push(`Day ${entry.round} vote: ${name(d.playerId)} ${how}${roleText(d.role)}.`);
      }
    } else if (entry.kind === "kicked") {
      out.push(`Day ${entry.round}: ${name(entry.playerId)} was removed by the host.`);
    }
  }
  return out.slice(-12);
}

export class BotTalk {
  private readonly rooms = new Map<string, TalkRoom>();

  constructor(private readonly host: TalkHost) {}

  private room(code: string): TalkRoom {
    let r = this.rooms.get(code);
    if (!r) {
      r = {
        lines: [],
        speech: null,
        lastSpeechAt: -Infinity,
        chain: 0,
        posted: 0,
        phase: "",
        aiFailures: 0,
        aiPausedUntil: 0,
        topics: new Map(),
        pending: [],
        listen: null,
        lastListenAt: -Infinity,
      };
      this.rooms.set(code, r);
    }
    return r;
  }

  /** The host's AI can be used now: switched on, and a person is hosting and connected. */
  aiAvailable(room: Room): boolean {
    const state = room.state;
    if (!state.settings.aiBotChat || state.hostId === null) return false;
    const host = state.players.find((p) => p.id === state.hostId);
    if (!host || host.isBot || host.botControlled || !host.connected || room.reconnecting[host.id] !== undefined) return false;
    return this.host.clock() >= this.room(room.code).aiPausedUntil;
  }

  // ------------------------------------------------------------ queueing a bot's message

  /** A bot wants to say something. Checked like everything a bot does; "typing…" shows straight away. */
  enqueue(room: Room, botId: string, intent: BotIntent): TalkResult {
    const state = room.state;
    const bot = state.players.find((p) => p.id === botId);
    if (!bot || bot.kicked || !(bot.isBot || bot.botControlled)) return no("NOT_IN_ROOM", "That seat isn't played by a bot.");
    const problem = this.checkIntent(state, intent);
    if (problem) return no("BAD_REQUEST", problem);
    // A bot standing in for someone who is away never speaks for them.
    if (!bot.isBot) return no("CHAT_NOT_ALLOWED", "A stand-in doesn't speak for its player.");
    const channel = chatChannelFor(state, botId);
    if (channel === null || channel === "graveyard") return no("CHAT_NOT_ALLOWED", "This bot can't talk right now.");
    if (channel === "public" && state.phase !== "DAY_DISCUSSION" && state.phase !== "VOTING") return no("CHAT_NOT_ALLOWED", "Bots talk during the day.");

    const talk = this.room(room.code);
    this.syncPhase(room);
    if (talk.lines.some((l) => l.botId === botId)) return no("RATE_LIMITED", "This bot is still typing.");
    if (talk.lines.length >= MAX_QUEUE) return no("RATE_LIMITED", "Too many bots are typing.");
    if (talk.posted + talk.lines.length >= phaseCap(state)) return no("RATE_LIMITED", "The bots have said enough for now.");
    const topic = topicOf(intent);
    if (topic && (talk.topics.get(topic.key) ?? 0) >= topic.limit) return no("RATE_LIMITED", "Someone already said that.");
    const replied = intent.replyToMessageId ? room.chat.find((m) => m.id === intent.replyToMessageId) : undefined;
    const replyToBot = !!replied && state.players.some((p) => p.id === replied.senderId && p.isBot);
    if (replyToBot) {
      const queued = talk.lines.filter((l) => l.replyToBot).length;
      if (talk.chain + queued >= BOT_REPLY_CHAIN_LIMIT) return no("RATE_LIMITED", "The bots have gone back and forth enough.");
    }

    const now = this.host.clock();
    const says = sanitizeChatText(intent.says) ?? "";
    const useAi = channel === "public" && this.aiAvailable(room);
    const line: QueuedLine = {
      key: randomUUID(),
      botId,
      intent: { ...intent, says },
      channel,
      typingSince: now,
      status: useAi ? "waiting" : "ready",
      text: useAi ? null : says,
      postAt: useAi ? Infinity : now + typingMs(says, this.host.random),
      replyToBot,
    };
    talk.lines.push(line);
    if (topic) talk.topics.set(topic.key, (talk.topics.get(topic.key) ?? 0) + 1);
    this.host.typing(room, botId, channel, true);
    this.schedule(room.code);
    return ok();
  }

  /** Every field of an intent must make sense: known act and tone, real players, a short clean line. */
  private checkIntent(state: GameState, intent: BotIntent): string | null {
    if (!intent || typeof intent !== "object") return "No message.";
    if (!isOneOf(SPEECH_ACTS, intent.act) || !isOneOf(SPEECH_TONES, intent.tone)) return "Unknown kind of message.";
    const player = (id: unknown) => typeof id === "string" && state.players.some((p) => p.id === id && !p.kicked);
    if (intent.targetId !== undefined && !player(intent.targetId)) return "Unknown player.";
    if (intent.aboutId !== undefined && !player(intent.aboutId)) return "Unknown player.";
    if (intent.role !== undefined && !isOneOf(ROLES, intent.role)) return "Unknown role.";
    if (intent.result !== undefined && intent.result !== "mafia" && intent.result !== "innocent") return "Unknown result.";
    if (intent.night !== undefined && (!Number.isInteger(intent.night) || intent.night < 1 || intent.night > 99)) return "Bad night.";
    if (intent.reason !== undefined && !isOneOf(SPEECH_REASONS, intent.reason)) return "Unknown reason.";
    if (intent.contradiction !== undefined && !isOneOf(CONTRADICTION_KINDS, intent.contradiction)) return "Unknown contradiction.";
    if (intent.topic !== undefined && !isOneOf(QUESTION_TOPICS, intent.topic)) return "Unknown topic.";
    const says = typeof intent.says === "string" ? sanitizeChatText(intent.says) : null;
    if (says === null || [...says].length > BOT_LINE_MAX_LENGTH || containsLink(says)) return "Bad line.";
    return null;
  }

  // ------------------------------------------------------------ people's messages

  /** A person said something in public: the reply chain resets, and the bots read it. */
  onHumanMessage(room: Room, message: ChatMessage): void {
    if (message.channel !== "public" || message.reaction || !publicTalkPhase(room.state)) return;
    const talk = this.room(room.code);
    talk.chain = 0;
    if (!room.state.players.some((p) => p.isBot || p.botControlled)) return;
    if (this.aiAvailable(room)) {
      talk.pending.push(message);
      this.schedule(room.code);
    } else {
      this.read(room, [message]);
    }
  }

  /** The keyword reader, for when the AI is off or didn't answer. */
  private read(room: Room, messages: ChatMessage[]): void {
    const players = namedPlayers(room.state);
    const events = messages.flatMap((m) => parseMessage(m, players));
    if (events.length > 0) this.host.heard(room, events);
  }

  /** After a restart: the bots lost their memory, so they re-read what was said in public this game. */
  rehear(room: Room): void {
    if (room.state.phase === "LOBBY" || room.state.phase === "GAME_OVER") return;
    // Strictly after the start: nobody can post in public during the role reveal, so anything at that very moment is lobby talk.
    const since = room.gameStartedAt ?? -Infinity;
    this.read(
      room,
      room.chat.filter((m) => m.channel === "public" && !m.reaction && m.sentAt > since),
    );
  }

  // ------------------------------------------------------------ phases and rooms

  /** A new phase: lines that can't be said any more are dropped, and the counts start again. */
  syncPhase(room: Room): void {
    const talk = this.room(room.code);
    const key = phaseKey(room.state);
    if (talk.phase === key) return;
    talk.phase = key;
    talk.posted = 0;
    talk.topics.clear();
    if (room.state.phase === "DAY_DISCUSSION") talk.chain = 0;
    const keep: QueuedLine[] = [];
    for (const line of talk.lines) {
      if (chatChannelFor(room.state, line.botId) === line.channel && (line.channel !== "public" || room.state.phase === "VOTING" || room.state.phase === "DAY_DISCUSSION")) {
        keep.push(line);
      } else {
        this.host.typing(room, line.botId, line.channel, false);
      }
    }
    talk.lines = keep;
    if (talk.speech && !keep.some((l) => talk.speech?.keys.includes(l.key))) talk.speech = null;
    // Leaving the day: whatever was waiting to be read is read now, with the keyword reader.
    if (!publicTalkPhase(room.state) && talk.pending.length > 0) {
      const pending = talk.pending;
      talk.pending = [];
      this.read(room, pending);
    }
    this.schedule(room.code);
  }

  dropRoom(code: string): void {
    this.rooms.delete(code);
    this.host.scheduler.clear(`${code}:talk`);
  }

  /** The host changed (or switched the AI off): anything waiting for the AI is written from the ready-made lines. */
  aiGone(room: Room): void {
    const talk = this.rooms.get(room.code);
    if (!talk || this.aiAvailable(room)) return;
    this.fallBack(room, talk, talk.lines.filter((l) => l.status !== "ready"));
    talk.speech = null;
    if (talk.pending.length > 0 || talk.listen) {
      const messages = [...(talk.listen?.batch.map((b) => b.message) ?? []), ...talk.pending] as ChatMessage[];
      talk.pending = [];
      talk.listen = null;
      this.read(room, messages);
    }
    this.schedule(room.code);
  }

  // ------------------------------------------------------------ the host's answers

  /** The host's AI wrote the messages (or null: it couldn't). Each one is checked; failures use the ready-made line. */
  async submitSpeech(room: Room, requestId: string, messages: Array<{ id: string; text: string }> | null): Promise<void> {
    const talk = this.rooms.get(room.code);
    const speech = talk?.speech;
    if (!talk || !speech || speech.requestId !== requestId) return;
    talk.speech = null;
    const lines = talk.lines.filter((l) => speech.keys.includes(l.key));
    if (messages === null) {
      this.aiFailed(talk);
      this.fallBack(room, talk, lines);
    } else {
      talk.aiFailures = 0;
      const names = room.state.players.filter((p) => !p.kicked).map((p) => p.name).concat(room.state.spectators.map((s) => s.name));
      let rejected = 0;
      speech.keys.forEach((key, index) => {
        const line = lines.find((l) => l.key === key);
        if (!line) return;
        const id = `s${index + 1}`;
        const intent = speech.intents.get(id);
        const written = messages.find((m) => m.id === id)?.text;
        const check = intent
          ? checkBotLine(written, { mode: room.state.settings.contentMode, gang: gangName(room.state.settings), intent, names })
          : ({ ok: false, reason: "empty" } as const);
        if (!check.ok) rejected++;
        this.decide(line, check.ok ? check.text : line.intent.says);
      });
      if (rejected > 0) this.host.logger.info("bots.ai_line_rejected", { room: room.code, rejected, of: lines.length });
    }
    this.schedule(room.code);
    await this.flush(room);
  }

  /** The host's AI read the chat (or null). Its report is validated; with nothing usable, the keyword reader reads. */
  submitListen(room: Room, requestId: string, events: unknown[] | null): void {
    const talk = this.rooms.get(room.code);
    const listen = talk?.listen;
    if (!talk || !listen || listen.requestId !== requestId) return;
    talk.listen = null;
    if (events === null) {
      this.aiFailed(talk);
      this.read(room, listen.batch.map((b) => b.message) as ChatMessage[]);
    } else {
      talk.aiFailures = 0;
      const heard = validateAiHeard(events, listen.batch, namedPlayers(room.state));
      if (heard.length > 0) this.host.heard(room, heard);
    }
    this.schedule(room.code);
  }

  private aiFailed(talk: TalkRoom): void {
    talk.aiFailures++;
    // Three failures in a row: stop asking for a minute so bots don't keep waiting.
    if (talk.aiFailures >= 3) {
      talk.aiPausedUntil = this.host.clock() + 60_000;
      talk.aiFailures = 0;
    }
  }

  private decide(line: QueuedLine, text: string): void {
    line.text = text;
    line.status = "ready";
    line.postAt = Math.max(this.host.clock(), line.typingSince + typingMs(text, this.host.random));
  }

  private fallBack(room: Room, talk: TalkRoom, lines: QueuedLine[]): void {
    void room;
    void talk;
    for (const line of lines) this.decide(line, line.intent.says);
  }

  // ------------------------------------------------------------ the clock

  private schedule(code: string): void {
    const talk = this.rooms.get(code);
    if (!talk) return;
    const times: number[] = [];
    for (const line of talk.lines) if (line.status === "ready") times.push(line.postAt);
    const waiting = talk.lines.filter((l) => l.status === "waiting");
    if (waiting.length > 0 && !talk.speech) {
      const oldest = Math.min(...waiting.map((l) => l.typingSince));
      const batched = waiting.length >= BOT_SPEECH_BATCH ? oldest : oldest + BATCH_WAIT_MS;
      times.push(Math.max(batched, talk.lastSpeechAt + BOT_SPEECH_MIN_INTERVAL_MS));
    }
    if (talk.speech) times.push(talk.speech.deadline);
    if (talk.pending.length > 0 && !talk.listen) {
      const oldest = Math.min(...talk.pending.map((m) => m.sentAt));
      times.push(Math.max(oldest + LISTEN_WAIT_MS, talk.lastListenAt + BOT_LISTEN_INTERVAL_MS));
    }
    if (talk.listen) times.push(talk.listen.deadline);
    const key = `${code}:talk`;
    if (times.length === 0) {
      this.host.scheduler.clear(key);
      return;
    }
    const at = Math.max(this.host.clock(), Math.min(...times));
    this.host.scheduler.set(key, at, () => {
      void this.host
        .withRoom(code, async (room) => {
          await this.flush(room);
        })
        .catch((err: unknown) => this.host.logger.error("bots.talk_failed", { room: code }, err));
    });
  }

  /** Does whatever is due: AI calls that ran out of time, new AI calls, and messages ready to appear. */
  async flush(room: Room): Promise<void> {
    const talk = this.rooms.get(room.code);
    if (!talk) return;
    this.syncPhase(room);
    const now = this.host.clock();
    const ai = this.aiAvailable(room);

    // Writing.
    if (talk.speech && now >= talk.speech.deadline) {
      const keys = talk.speech.keys;
      talk.speech = null;
      this.aiFailed(talk);
      this.fallBack(room, talk, talk.lines.filter((l) => keys.includes(l.key)));
      this.host.logger.info("bots.ai_speech_timeout", { room: room.code });
    }
    const waiting = talk.lines.filter((l) => l.status === "waiting");
    if (waiting.length > 0 && !ai) this.fallBack(room, talk, waiting);
    else if (waiting.length > 0 && !talk.speech && now >= talk.lastSpeechAt + BOT_SPEECH_MIN_INTERVAL_MS) {
      const oldest = Math.min(...waiting.map((l) => l.typingSince));
      if (waiting.length >= BOT_SPEECH_BATCH || now >= oldest + BATCH_WAIT_MS) this.askToWrite(room, talk, waiting.slice(0, BOT_SPEECH_BATCH));
    }

    // Reading.
    if (talk.listen && now >= talk.listen.deadline) {
      const batch = talk.listen.batch;
      talk.listen = null;
      this.aiFailed(talk);
      this.read(room, batch.map((b) => b.message) as ChatMessage[]);
    }
    if (talk.pending.length > 0 && !talk.listen) {
      if (!ai) {
        const pending = talk.pending;
        talk.pending = [];
        this.read(room, pending);
      } else if (now >= talk.lastListenAt + BOT_LISTEN_INTERVAL_MS && now >= Math.min(...talk.pending.map((m) => m.sentAt)) + LISTEN_WAIT_MS) {
        this.askToRead(room, talk);
      }
    }

    // Posting, in the order the bots started typing.
    const due = talk.lines.filter((l) => l.status === "ready" && l.postAt <= now).sort((a, b) => a.typingSince - b.typingSince);
    for (const line of due) {
      talk.lines = talk.lines.filter((l) => l !== line);
      await this.postLine(room, talk, line);
    }
    this.schedule(room.code);
  }

  private async postLine(room: Room, talk: TalkRoom, line: QueuedLine): Promise<void> {
    const state = room.state;
    const bot = state.players.find((p) => p.id === line.botId);
    const stillOk = bot && bot.isBot && bot.alive && !bot.kicked && chatChannelFor(state, line.botId) === line.channel;
    if (!stillOk || line.text === null) {
      this.host.typing(room, line.botId, line.channel, false);
      return;
    }
    if (line.replyToBot) {
      // Bots answering bots: a couple of times in a row, then they wait for a person.
      if (talk.chain >= BOT_REPLY_CHAIN_LIMIT) {
        this.host.typing(room, line.botId, line.channel, false);
        return;
      }
      talk.chain++;
    }
    this.host.typing(room, line.botId, line.channel, false);
    const message = await this.host.post(room, line.botId, line.text);
    if (!message) return;
    talk.posted++;
    // Only public words are "heard": a Mafia-chat line never becomes anyone's knowledge.
    if (message.channel === "public") this.host.heard(room, heardFromIntent(line.intent, line.botId, message.id, message.sentAt));
  }

  // ------------------------------------------------------------ asking the host's AI (public information only)

  private askToWrite(room: Room, talk: TalkRoom, lines: QueuedLine[]): void {
    const state = room.state;
    const host = state.hostId;
    if (host === null) return;
    const view = publicView(state);
    const nameOf = (id: string | undefined) => (id === undefined ? undefined : view.players.find((p) => p.id === id)?.name);
    const intents = new Map<string, SpeechIntent>();
    const list: SpeechIntent[] = lines.map((line, index) => {
      const i = line.intent;
      const replied = i.replyToMessageId ? room.chat.find((m) => m.id === i.replyToMessageId && m.channel === "public" && !m.reaction) : undefined;
      const intent: SpeechIntent = {
        id: `s${index + 1}`,
        bot: nameOf(line.botId) ?? "Bot",
        act: i.act,
        tone: i.tone,
        says: i.says,
      };
      const target = nameOf(i.targetId);
      const about = nameOf(i.aboutId);
      if (target) intent.target = target;
      if (about) intent.about = about;
      if (i.role) intent.role = i.role;
      if (i.result) intent.result = i.result;
      if (i.night !== undefined) intent.night = i.night;
      if (i.reason) intent.reason = i.reason;
      if (i.contradiction) intent.contradiction = i.contradiction;
      if (i.topic) intent.topic = i.topic;
      if (replied) intent.replyTo = { from: replied.senderName, text: replied.text };
      intents.set(intent.id, intent);
      return intent;
    });
    const speakers = [...new Set(lines.map((l) => l.botId))];
    const requestId = randomUUID().replace(/-/g, "");
    const payload: BotSpeechRequestPayload = {
      requestId,
      timeoutMs: BOT_SPEECH_TIMEOUT_MS,
      mode: state.settings.contentMode,
      gang: gangName(state.settings),
      day: state.round,
      players: view.players.filter((p) => p.alive && !p.kicked).map((p) => p.name),
      events: describeEvents(view),
      chat: room.chat
        .filter((m) => m.channel === "public" && !m.reaction && m.text.length > 0)
        .slice(-CHAT_CONTEXT)
        .map((m) => ({ from: m.senderName, text: m.text })),
      bots: speakers.map((id) => ({ name: nameOf(id) ?? "Bot", style: styleDescription(room.botProfiles[id]?.style ?? "chatty") })),
      intents: list,
    };
    for (const line of lines) line.status = "asking";
    const now = this.host.clock();
    talk.speech = { requestId, keys: lines.map((l) => l.key), deadline: now + BOT_SPEECH_TIMEOUT_MS, intents };
    talk.lastSpeechAt = now;
    this.host.speechRequest(room, host, payload);
  }

  private askToRead(room: Room, talk: TalkRoom): void {
    const state = room.state;
    const host = state.hostId;
    if (host === null) return;
    // Older messages beyond one batch are read by the keyword reader straight away.
    const overflow = talk.pending.slice(0, Math.max(0, talk.pending.length - BOT_LISTEN_BATCH));
    if (overflow.length > 0) this.read(room, overflow);
    const batchMessages = talk.pending.slice(-BOT_LISTEN_BATCH);
    talk.pending = [];
    const batch = batchMessages.map((message, i) => ({ n: i + 1, message }));
    const firstAt = batchMessages[0]?.sentAt ?? 0;
    const view = publicView(state);
    const requestId = randomUUID().replace(/-/g, "");
    const payload: BotListenRequestPayload = {
      requestId,
      timeoutMs: BOT_LISTEN_TIMEOUT_MS,
      gang: gangName(state.settings),
      players: view.players.filter((p) => !p.kicked).map((p) => p.name),
      context: room.chat
        .filter((m) => m.channel === "public" && !m.reaction && m.text.length > 0 && m.sentAt < firstAt)
        .slice(-4)
        .map((m) => ({ from: m.senderName, text: m.text })),
      messages: batchMessages.map((m, i) => ({ n: i + 1, from: m.senderName, text: m.text })),
    };
    const now = this.host.clock();
    talk.listen = { requestId, batch, deadline: now + BOT_LISTEN_TIMEOUT_MS };
    talk.lastListenAt = now;
    this.host.listenRequest(room, host, payload);
  }
}
