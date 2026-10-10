import { NARRATION_MAX_LENGTH, containsProfanity, findBannedWord, stripEmoji, type ContentMode } from "@mafia/shared";

export type NarrationRejection =
  | "empty"
  | "too_long"
  | "markup"
  | "banned_word"
  | "profanity"
  | "missing_name"
  | "mentions_other_player"
  | "reveals_role";

export interface NarrationCheckContext {
  mode: ContentMode;
  /** Everyone who left the game in this announcement: each name must appear. */
  eliminatedNames: readonly string[];
  /** Every other player: none of their names may appear (the narrator knows nothing about them). */
  otherNames: readonly string[];
  /** A save was announced, so the Doctor may be mentioned. */
  mayMentionDoctor: boolean;
}

export type NarrationCheck = { ok: true; text: string } | { ok: false; reason: NarrationRejection };

const reject = (reason: NarrationRejection): NarrationCheck => ({ ok: false, reason });

const LETTER_OR_DIGIT = "[\\p{L}\\p{N}]";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A name as a whole word: not part of a longer word ("Sam" is not in "Samuel"). */
export function nameRegExp(name: string, flags: string): RegExp {
  return new RegExp(`(?<!${LETTER_OR_DIGIT})${escapeRegExp(name)}(?!${LETTER_OR_DIGIT})`, flags);
}

/** Replaces every whole-word occurrence of the names (longest first) so they aren't judged as ordinary words. */
export function maskNames(text: string, names: readonly string[], mask: string): string {
  let out = text;
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (name.trim() === "") continue;
    out = out.replace(nameRegExp(name, "giu"), mask);
  }
  return out;
}

/** Tidies what the AI returned: one line, no emoji or text faces, no wrapping quotation marks. */
export function tidyNarration(raw: string): string {
  let text = stripEmoji(
    raw
      .replace(/\u200d/g, "")
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
      .replace(/\s+/g, " "),
  );
  const wrapped = /^["“”'‘’](.*)["“”'‘’]$/u.exec(text);
  if (wrapped && !/["“”]/.test(wrapped[1] ?? "")) text = (wrapped[1] ?? "").trim();
  return text;
}

export const MARKUP = /<[^>]*>|```|https?:\/\/|www\.|\]\(|^#{1,6}\s|\*\*|__/m;

/** Roles the narrator must never mention: it knows nothing about them, and naming one hints at who holds it. */
const HIDDEN_ROLE_WORDS = /(?<![a-z0-9])(?:detectives?|investigators?|bodyguards?|cupid|jesters?|villagers?)(?![a-z0-9])/i;
const DOCTOR_WORDS = /(?<![a-z0-9])(?:doctors?|physicians?|medics?|nurses?)(?![a-z0-9])/i;
/** "Ana is the Mafia", "§ was not a Sneaky Gang member": a claim about what someone is. */
const IDENTITY_CLAIM =
  /§\s+(?:is|was|were|are|turned out to be|must be|might be)\s+(?:not\s+)?(?:(?:the|a|an|one of the|part of the|in the|with the)\s+)?(?:mafia|sneaky gang|gang)/i;

/**
 * Decides whether a narration written by the AI is fit to show everyone. The
 * server runs this on whatever the host's browser sends; a failure means a
 * ready-made line is used instead. Names are taken out before the word checks,
 * so a player's nickname can't make a good narration fail (or hide a bad one:
 * the names are checked on their own).
 */
export function checkNarration(raw: unknown, ctx: NarrationCheckContext): NarrationCheck {
  if (typeof raw !== "string") return reject("empty");
  const text = tidyNarration(raw);
  if (text.length === 0) return reject("empty");
  if ([...text].length > NARRATION_MAX_LENGTH) return reject("too_long");

  // Everyone who left must be named.
  for (const name of ctx.eliminatedNames) {
    if (!nameRegExp(name, "iu").test(text)) return reject("missing_name");
  }

  const masked = maskNames(text, ctx.eliminatedNames, "§");
  if (MARKUP.test(masked)) return reject("markup");

  // The narrator only knows who left; another player's name means it is making things up.
  const eliminatedKeys = new Set(ctx.eliminatedNames.map((n) => n.toLowerCase()));
  for (const name of ctx.otherNames) {
    if ([...name].length < 3 || eliminatedKeys.has(name.toLowerCase())) continue;
    if (nameRegExp(name, "u").test(masked)) return reject("mentions_other_player");
  }

  if (findBannedWord(masked, ctx.mode) !== null) return reject("banned_word");
  if (containsProfanity(masked)) return reject("profanity");

  if (HIDDEN_ROLE_WORDS.test(masked)) return reject("reveals_role");
  if (!ctx.mayMentionDoctor && DOCTOR_WORDS.test(masked)) return reject("reveals_role");
  if (IDENTITY_CLAIM.test(masked)) return reject("reveals_role");

  return { ok: true, text };
}
