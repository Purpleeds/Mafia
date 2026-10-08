/**
 * Puter.js: the AI behind the narrator. Puter uses a User-Pays model, so only
 * the host signs in; nobody else loads Puter or needs an account. The script is
 * loaded on demand, and only in the host's browser (when the lobby's settings
 * card is shown), so players never contact Puter at all.
 */
import { NARRATION_CLIENT_TIMEOUT_MS, buildNarratorMessages, type NarrationFacts, type NarratorMessage } from "@mafia/shared";

export const PUTER_SCRIPT_URL = "https://js.puter.com/v2/";
const LOAD_TIMEOUT_MS = 12_000;

/** The little part of Puter's API the narrator uses. */
export interface PuterApi {
  auth: {
    isSignedIn(): boolean;
    signIn(): Promise<unknown>;
    getUser?(): Promise<{ username?: unknown } | null | undefined>;
  };
  ai: {
    chat(messages: NarratorMessage[], options?: Record<string, unknown>): Promise<unknown>;
  };
}

declare global {
  interface Window {
    puter?: PuterApi;
  }
}

/** The loaded Puter, or null if its script hasn't run (or didn't define what we need). */
export function getPuter(): PuterApi | null {
  const puter = typeof window === "undefined" ? undefined : window.puter;
  return puter && typeof puter.auth?.signIn === "function" && typeof puter.ai?.chat === "function" ? puter : null;
}

let loading: Promise<PuterApi> | null = null;

/** Adds <script src="https://js.puter.com/v2/"> once and resolves when Puter is ready. */
export function loadPuter(): Promise<PuterApi> {
  const ready = getPuter();
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  loading = new Promise<PuterApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PUTER_SCRIPT_URL;
    script.async = true;
    const finish = (error: Error | null) => {
      window.clearTimeout(timer);
      if (error) {
        script.remove();
        loading = null;
        reject(error);
        return;
      }
      const puter = getPuter();
      if (puter) resolve(puter);
      else {
        script.remove();
        loading = null;
        reject(new Error("Puter loaded, but isn't what we expected."));
      }
    };
    const timer = window.setTimeout(() => finish(new Error("Puter took too long to load.")), LOAD_TIMEOUT_MS);
    script.onload = () => finish(null);
    script.onerror = () => finish(new Error("Couldn't load Puter."));
    document.head.appendChild(script);
  });
  return loading;
}

export function isPuterSignedIn(puter: PuterApi | null = getPuter()): boolean {
  try {
    return puter?.auth.isSignedIn() === true;
  } catch {
    return false;
  }
}

/**
 * Starts Puter's sign-in. Call it straight from a click handler, before any
 * await: browsers only allow the sign-in popup when it opens inside the click.
 */
export function startPuterSignIn(): Promise<void> {
  const puter = getPuter();
  if (!puter) return Promise.reject(new Error("Puter hasn't loaded yet."));
  try {
    if (puter.auth.isSignedIn()) return Promise.resolve();
    return puter.auth.signIn().then(() => undefined);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error("Sign-in failed."));
  }
}

/** The signed-in Puter username, if Puter will say. */
export async function puterUsername(puter: PuterApi | null = getPuter()): Promise<string | null> {
  try {
    const user = await puter?.auth.getUser?.();
    const name = user?.username;
    return typeof name === "string" && name.length > 0 ? name.slice(0, 40) : null;
  } catch {
    return null;
  }
}

/**
 * Pulls the text out of whatever puter.ai.chat() resolved with: a string, an
 * OpenAI-style { message: { content } }, Claude-style content parts, or an
 * object that stringifies to its text.
 */
export function extractChatText(response: unknown): string | null {
  if (typeof response === "string") return response;
  if (response === null || typeof response !== "object") return null;
  const fromContent = (content: unknown): string | null => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return null;
    const joined = content
      .map((part): string => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
    return joined.length > 0 ? joined : null;
  };
  const record = response as Record<string, unknown>;
  const message = record.message;
  if (message && typeof message === "object") {
    const text = fromContent((message as { content?: unknown }).content);
    if (text) return text;
  }
  if (typeof record.text === "string") return record.text;
  const direct = fromContent(record.content);
  if (direct) return direct;
  const stringified = String(response);
  return stringified && stringified !== "[object Object]" ? stringified : null;
}

export interface WriteNarrationOptions {
  /** For tests: a stand-in for Puter. */
  puter?: PuterApi | null;
  timeoutMs?: number;
}

/**
 * Asks Puter's AI to write the narration for these public facts. Returns null if
 * it can't: Puter missing, nobody signed in (no popup is ever opened from here),
 * an error, an empty answer, or no answer within the time limit. Never throws.
 */
export async function writeNarration(facts: NarrationFacts, options: WriteNarrationOptions = {}): Promise<string | null> {
  const puter = options.puter === undefined ? getPuter() : options.puter;
  const timeoutMs = options.timeoutMs ?? NARRATION_CLIENT_TIMEOUT_MS;
  if (!puter || !isPuterSignedIn(puter)) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const answer = Promise.resolve(puter.ai.chat(buildNarratorMessages(facts))).then(extractChatText, () => null);
    const text = await Promise.race([answer, timeout]);
    const trimmed = text?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
