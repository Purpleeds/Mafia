import {
  BOT_LISTEN_CLIENT_TIMEOUT_MS,
  BOT_SPEECH_CLIENT_TIMEOUT_MS,
  HEARD_TYPES,
  buildBotListenMessages,
  buildBotSpeechMessages,
  extractJsonValue,
  type BotListenRequestPayload,
  type BotSpeechRequestPayload,
} from "@mafia/shared";
import { call } from "../net/socket";
import { askPuter, type PuterApi } from "./puter";

/**
 * The host's browser does the bots' AI work, like the narrator: the server
 * sends only public information (what the bots decided to say, the public
 * chat, who is still in, what everyone saw happen, the speaking styles). The
 * AI never learns anyone's role, so nothing a player types can make it reveal
 * one. The server checks everything sent back and falls back to ready-made
 * lines (or its own keyword reader) whenever the answer isn't good.
 */

interface AiOptions {
  /** For tests: a stand-in for Puter. */
  puter?: PuterApi | null;
  timeoutMs?: number;
}

const clientTimeout = (requested: number, cap: number) => Math.min(cap, Math.max(1000, requested - 1000));

/** The messages the AI wrote, one per intent id; null if it couldn't (or answered something unusable). */
export async function writeBotMessages(payload: BotSpeechRequestPayload, options: AiOptions = {}): Promise<Array<{ id: string; text: string }> | null> {
  const text = await askPuter(buildBotSpeechMessages(payload), {
    puter: options.puter,
    timeoutMs: options.timeoutMs ?? clientTimeout(payload.timeoutMs, BOT_SPEECH_CLIENT_TIMEOUT_MS),
  });
  if (text === null) return null;
  const value = extractJsonValue(text);
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { messages?: unknown }).messages)
      ? ((value as { messages: unknown[] }).messages)
      : null;
  if (!list) return null;
  const ids = new Set(payload.intents.map((i) => i.id));
  const out: Array<{ id: string; text: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { id, text: line } = item as { id?: unknown; text?: unknown };
    if (typeof id === "string" && ids.has(id) && typeof line === "string") out.push({ id, text: line.slice(0, 600) });
  }
  return out.length > 0 ? out.slice(0, 10) : null;
}

const KEEP = ["msg", "type", "role", "target", "result", "night", "confident", "evidence", "to", "about", "with", "voted_for"] as const;

/** What the AI read in the messages, trimmed to the fields the server understands; null if it couldn't. */
export async function readBotChat(payload: BotListenRequestPayload, options: AiOptions = {}): Promise<unknown[] | null> {
  const text = await askPuter(buildBotListenMessages(payload), {
    puter: options.puter,
    timeoutMs: options.timeoutMs ?? clientTimeout(payload.timeoutMs, BOT_LISTEN_CLIENT_TIMEOUT_MS),
  });
  if (text === null) return null;
  const value = extractJsonValue(text);
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? (value as { events?: unknown }).events : null;
  if (!Array.isArray(list)) return null;
  const events: unknown[] = [];
  for (const item of list.slice(0, 40)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    if (!(HEARD_TYPES as readonly string[]).includes(String(r.type))) continue;
    const clean: Record<string, unknown> = {};
    for (const key of KEEP) {
      const v = r[key];
      if (typeof v === "string") clean[key] = v.slice(0, 60);
      else if (typeof v === "number" || typeof v === "boolean" || v === null) clean[key] = v;
    }
    events.push(clean);
  }
  return events;
}

/** The server asked this (host's) browser to write bot messages. */
export async function handleBotSpeechRequest(payload: BotSpeechRequestPayload): Promise<void> {
  const messages = await writeBotMessages(payload);
  await call("bots:speechSubmit", { requestId: payload.requestId, messages });
}

/** The server asked this (host's) browser to read some public messages for the bots. */
export async function handleBotListenRequest(payload: BotListenRequestPayload): Promise<void> {
  const events = await readBotChat(payload);
  await call("bots:listenSubmit", { requestId: payload.requestId, events });
}
