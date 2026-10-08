import { NARRATION_TIMEOUT_MS, type GameError } from "@mafia/shared";
import { checkNarration } from "../narration/checks.js";
import { narrationFacts } from "../narration/facts.js";
import { pickTemplate } from "../narration/templates.js";
import type { GameEnv, GameState, NarrationFallback } from "./types.js";

/** When the AI answers late, the players still get at least this long to read it before the phase ends. */
const READING_TIME_AFTER_LATE_ANSWER_MS = 5000;

function newNarrationId(env: GameEnv): string {
  return Array.from({ length: 3 }, () => Math.floor(env.rng() * 0x1_0000_0000).toString(36)).join("");
}

/**
 * Starts the announcement for the result that was just recorded. With the AI
 * narrator off it is written at once from the ready-made lines; otherwise it
 * waits (up to the deadline) for the host's browser, and the room service asks
 * for it after the state is saved.
 */
export function beginNarration(s: GameState, kind: "night" | "vote", env: GameEnv): void {
  s.narration = {
    id: newNarrationId(env),
    kind,
    round: s.round,
    status: "pending",
    deadline: env.now + NARRATION_TIMEOUT_MS,
    text: null,
    source: null,
    fallback: null,
  };
  if (!s.settings.aiNarrator) finishNarration(s, null, "ai_off", env, false);
}

/**
 * Settles a pending announcement. A candidate (the AI's text) must pass the
 * checks for the current mode; otherwise, or with no candidate, a ready-made
 * line is used. `late` means the phase has been running for a while, so the
 * phase timer is stretched to leave time to read.
 */
export function finishNarration(
  s: GameState,
  candidate: string | null,
  reason: NarrationFallback | null,
  env: GameEnv,
  late: boolean,
): void {
  const narration = s.narration;
  if (!narration || narration.status !== "pending") return;
  const facts = narrationFacts(s);
  if (!facts) return;

  let fallback: NarrationFallback | null = candidate === null ? (reason ?? "ai_failed") : null;
  let text: string | null = null;
  if (candidate !== null) {
    const checked = checkNarration(candidate, {
      mode: s.settings.contentMode,
      eliminatedNames: facts.eliminated.map((e) => e.name),
      otherNames: s.players.map((p) => p.name),
      mayMentionDoctor: facts.saved,
    });
    if (checked.ok) {
      text = checked.text;
      narration.source = "ai";
    } else {
      fallback = `rejected_${checked.reason}`;
    }
  }

  if (text === null) {
    const pick = pickTemplate(facts, s.usedTemplates, env.rng);
    if (pick.restarted) s.usedTemplates = s.usedTemplates.filter((id) => !pick.poolIds.includes(id));
    s.usedTemplates.push(pick.id);
    text = pick.text;
    narration.source = "template";
  }

  narration.status = "ready";
  narration.text = text;
  narration.fallback = fallback;
  if (late && s.phaseEndsAt !== null) {
    s.phaseEndsAt = Math.max(s.phaseEndsAt, env.now + READING_TIME_AFTER_LATE_ANSWER_MS);
  }
}

/** The host's answer (or the lack of one) arrived. */
export function narrate(
  s: GameState,
  candidate: string | null,
  reason: NarrationFallback | undefined,
  env: GameEnv,
): GameError | null {
  if (!s.narration || s.narration.status !== "pending") {
    return { code: "WRONG_PHASE", message: "Nothing is waiting to be narrated." };
  }
  finishNarration(s, candidate, reason ?? null, env, true);
  return null;
}

/** True while the players are waiting for the narrator, so the phase must not move on. */
export function isNarrationPending(s: GameState): boolean {
  return s.narration?.status === "pending";
}

/** A pending narration that has run out of time becomes a ready-made line. */
export function expireNarration(s: GameState, env: GameEnv): void {
  const n = s.narration;
  if (n && n.status === "pending" && env.now >= n.deadline) finishNarration(s, null, "timeout", env, true);
}

/**
 * When the next timer should fire: the narrator's deadline while one is
 * pending (the phase waits for it), otherwise the end of the phase.
 */
export function nextWake(s: GameState): number | null {
  if (s.narration?.status === "pending") return s.narration.deadline;
  return s.phaseEndsAt;
}
