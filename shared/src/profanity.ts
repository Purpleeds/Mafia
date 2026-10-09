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

/** True if this single word is on one of the supplementary lists. */
function isBlockedWord(word: string): boolean {
  const normalized = normalizeForCheck(word);
  const letters = normalized.replace(/[^A-Z]/g, "");
  if (letters.length === 0) return false;
  if (BLOCKED_SUBSTRINGS.some((s) => letters.includes(s))) return true;
  return BLOCKED_WORDS.has(letters) || BLOCKED_WORDS.has(letters.replace(/(.)\1+/g, "$1"));
}

const WORD = /[\p{L}\p{N}@$*]+/gu;

/** Covers whole words with asterisks: any word that `hit` says yes to, or that overlaps one of `ranges`. */
function maskWords(text: string, ranges: Array<[number, number]>, hit: (word: string) => boolean): string {
  return text.replace(WORD, (word, offset: number) => {
    const end = offset + word.length - 1;
    const overlaps = ranges.some(([a, b]) => a <= end && b >= offset);
    return overlaps || hit(word) ? "*".repeat([...word].length) : word;
  });
}

/**
 * The standard chat filter: covers strong swear words, slurs and sexual words
 * with asterisks ("what the ****") and leaves everything else as it was. The
 * whole word goes ("****" for "asshole", not "***hole") and word lengths are
 * kept, so the sentence still reads.
 */
export function censorProfanity(text: string): string {
  const ranges = matcher.getAllMatches(text).map((m): [number, number] => [m.startIndex, m.endIndex]);
  return maskWords(text, ranges, isBlockedWord);
}

// ---------------------------------------------------------------- chat filter levels

/**
 * How much the chat filter hides, set by the host. Safe Mode is always
 * "strict" (see effectiveChatFilter); "uncensored" is a Normal Mode choice.
 *
 *  - strict:     strong language, slurs and sexual words, plus milder swearing and insults.
 *  - standard:   strong language, slurs and sexual words, and telling someone to hurt themselves.
 *  - uncensored: nothing is hidden. Links, length and rate limits still apply.
 */
export const CHAT_FILTERS = ["strict", "standard", "uncensored"] as const;
export type ChatFilter = (typeof CHAT_FILTERS)[number];

/** Telling someone to hurt themselves: hidden from "standard" up. */
const HARMFUL_PHRASES = /\b(?:kys|kill\s*(?:yo)?u?r\s*self|go\s+die)\b/giu;

/** Milder words that "strict" hides as well (whole words only: "hello" and "shell" are fine). */
const MILD_WORDS = new Set([
  "DAMN", "DAMNIT", "DAMMIT", "GODDAMN", "GODDAMMIT", "HELL", "CRAP", "CRAPPY", "BLOODY", "BUGGER", "SUCKS", "SUCKER",
  "IDIOT", "IDIOTS", "IDIOTIC", "STUPID", "DUMB", "DUMBO", "MORON", "MORONS", "LOSER", "LOSERS", "JERK", "JERKS",
  "FREAKING", "FRIGGING", "FRICKING", "FRICK", "PISSED", "SHUTUP",
]);
const MILD_PHRASES = /\bshut\s+up\b/giu;

function isMildWord(word: string): boolean {
  const letters = normalizeForCheck(word).replace(/[^A-Z]/g, "");
  return letters.length > 0 && (MILD_WORDS.has(letters) || MILD_WORDS.has(letters.replace(/(.)\1+/g, "$1")));
}

function maskPhrases(text: string, pattern: RegExp): string {
  return text.replace(pattern, (phrase) => phrase.replace(/[^\s]/gu, "*"));
}

/** Applies a chat filter level to a message. The server runs it for the room; a player can also run "strict" on their own screen. */
export function filterChatText(text: string, level: ChatFilter): string {
  if (level === "uncensored") return text;
  const standard = maskPhrases(censorProfanity(text), HARMFUL_PHRASES);
  if (level === "standard") return standard;
  return maskPhrases(maskWords(standard, [], isMildWord), MILD_PHRASES);
}

// ---------------------------------------------------------------- links

/** Top-level domains that are rarely anything but the end of a web address. */
const LINK_TLDS = [
  "com", "net", "org", "edu", "gov", "io", "co", "ly", "gg", "xyz", "info", "biz", "tv", "uk", "ru", "cn", "de",
  "fr", "jp", "br", "au", "ca", "eu", "nl", "tk", "ml", "ga", "cf", "gq", "pw", "cc", "ws", "fm", "ai", "gl", "gd",
  "vc", "sh", "es", "ch", "se", "fi", "pl", "cz", "dk", "ie", "nz", "za", "mx", "ar", "tr", "ir", "vn", "kr", "tw",
  "hk", "sg", "ph", "ua", "ro", "hu", "gr", "pt", "sk", "nu", "su", "icu", "xxx", "zip", "mov",
];
/**
 * Domains that are also English words. A sentence typed without a space after
 * the full stop ("so.Me too") shouldn't count as a link, so these only count in
 * lower case ("free.gift") or with a path after them ("get.free/robux").
 */
const WORD_TLDS = [
  "me", "to", "us", "one", "win", "best", "rest", "work", "free", "fun", "live", "top", "page", "cam", "bet", "pro",
  "lol", "gift", "gifts", "money", "loan", "space", "tech", "website", "bid", "sex", "porn", "link", "click", "shop",
  "store", "site", "online", "app", "dev", "club", "vip",
];

const HOST = "(?<![\\p{L}\\p{N}@-])[a-z0-9][a-z0-9-]{0,62}(?:\\.[a-z0-9-]{1,63})*\\.";
const END = "(?![\\p{L}\\p{N}-])";

const LINK_PATTERNS: RegExp[] = [
  // A scheme ("https://", also spaced out or "hxxp") or "www."
  /(?:\b(?:https?|ftp|hxxps?)\s*:\s*\/\s*\/|\bwww\s*\.)/iu,
  // example.com, example.gg/abc
  new RegExp(`${HOST}(?:${LINK_TLDS.join("|")})${END}`, "iu"),
  // free.gift (lower case), or any case with a path: Free.Gift/robux
  new RegExp(`${HOST}(?:${WORD_TLDS.join("|")})${END}`, "u"),
  new RegExp(`${HOST}(?:${WORD_TLDS.join("|")})\\/`, "iu"),
  // "example dot com", "example (dot) gg"
  /\b[a-z0-9-]{2,}\s*[([]?\s*\bdot\b\s*[)\]]?\s*(?:com|net|org|io|gg|ly|co|xyz|info|ru|uk|tk|ml|ga|cf|gq|cc|ws)\b/iu,
  // An IP address
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/u,
];

/**
 * True if a chat message contains something that could become a link: a web
 * address, a bare domain, "example dot com" or an IP address. Links are blocked
 * at every chat filter level, to keep spam and scam sites out of the game.
 */
export function containsLink(text: string): boolean {
  const flat = text.normalize("NFKC");
  return LINK_PATTERNS.some((pattern) => pattern.test(flat));
}
