import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

/**
 * Rude-word check used for room codes and nicknames, on both the client (for
 * instant feedback) and the server (which enforces it). `obscenity` handles
 * leetspeak and avoids false positives such as "class" or "Scunthorpe"; the
 * short lists below cover terms it misses, which matter for 4–8 letter codes.
 */
const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

/** Blocked anywhere inside a word. */
const BLOCKED_SUBSTRINGS = ["NIGG", "FCUK", "PHUK", "KUNT", "JIZZ", "HITLER", "KKK"];
/** Blocked as a whole word (they appear inside innocent words, e.g. "racoon"). */
const BLOCKED_WORDS = new Set([
  "COON", "SPIC", "WOP", "XXX", "NAZI", "NAZIS", "SHAG", "BTCH", "FUK", "FUC", "FUCC", "WTF", "STFU",
  "PEDO", "RETARD", "TRANNY", "DYKE", "SPAZ", "NIGA", "SIEG", "HEIL",
]);

const LEET: Record<string, string> = { "0": "O", "1": "I", "3": "E", "4": "A", "5": "S", "7": "T", "8": "B", "@": "A", $: "S" };

function normalizeForCheck(text: string): string {
  return text
    .toUpperCase()
    .replace(/[0134578@$]/g, (ch) => LEET[ch] ?? ch)
    .replace(/(.)\1{2,}/g, "$1$1"); // "FUUUK" -> "FUUK"
}

export function containsProfanity(text: string): boolean {
  if (matcher.hasMatch(text)) return true;
  const normalized = normalizeForCheck(text);
  const squashed = normalized.replace(/[^A-Z]/g, "");
  if (BLOCKED_SUBSTRINGS.some((s) => squashed.includes(s))) return true;
  const words = normalized.split(/[^A-Z]+/).filter(Boolean);
  return words.some((w) => BLOCKED_WORDS.has(w) || BLOCKED_WORDS.has(w.replace(/(.)\1+/g, "$1")));
}
