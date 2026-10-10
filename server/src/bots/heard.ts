/**
 * What players said in the public chat, as events bots can reason about:
 * "Sam claims Doctor", "Alex says Jordan is Mafia", "vote for Lee"...
 *
 * They come from three places, all public:
 *  - the host's AI reading the chat (validated here: every name must match a
 *    real player and appear in the message, unknown fields are dropped, and
 *    the server, not the AI, decides who said it);
 *  - the keyword parser below, when the AI is off or doesn't answer;
 *  - the bots' own messages, straight from the intent they were written from.
 *
 * Every bot in the room gets the same events. Nothing here sees a role.
 */
import {
  HEARD_TYPES,
  QUESTION_TOPICS,
  ROLES,
  SKIP,
  foldText,
  type ContradictionKind,
  type HeardType,
  type QuestionTopic,
  type Role,
} from "@mafia/shared";
import type { BotIntent } from "./port.js";

interface HeardBase {
  /** The public chat message it was said in. */
  messageId: string;
  speakerId: string;
  at: number;
  /** Said by a bot (its own intent), not read from a person's message. */
  byBot: boolean;
  /** The message it answered, when known (bots' replies). */
  replyTo: string | null;
}

export type Heard = HeardBase &
  (
    | { kind: "role_claim"; role: Role }
    | { kind: "result_claim"; targetId: string; result: "mafia" | "innocent"; night: number | null }
    | { kind: "accuse"; targetId: string; confident: boolean; evidence: "votes" | "claim" | null }
    | { kind: "defend"; targetId: string }
    | { kind: "vote_request"; targetId: string; toId: string | null }
    | { kind: "question"; toId: string; about: QuestionTopic }
    | { kind: "alliance"; withId: string }
    | { kind: "vote_evidence"; aboutId: string; votedForId: string }
    | { kind: "call_out"; targetId: string; contradiction: ContradictionKind; aboutId: string | null }
  );

export type HeardKind = Heard["kind"];

export interface NamedPlayer {
  id: string;
  name: string;
}

/** A public chat message, as the parsers need it. */
export interface HeardSource {
  id: string;
  senderId: string;
  text: string;
  sentAt: number;
}

// ---------------------------------------------------------------- names

/** Names that are also everyday words: only matched when written with a capital letter or an @. */
const COMMON_WORDS = new Set([
  "will", "may", "mark", "bill", "rose", "grace", "hope", "joy", "art", "ray", "sky", "max", "jack", "pat", "sue",
  "faith", "summer", "june", "april", "rich", "chase", "bob", "dawn", "sunny", "honey", "lucky", "buddy", "angel",
  "the", "and", "you", "not", "she", "him", "her", "all", "any", "one", "who", "what", "why", "yes", "no",
]);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0;
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

const key = (text: string) => foldText(text).replace(/^@+/, "").replace(/\s+/g, " ").trim();

/**
 * The player a written name means: the same name in any case or accent, an
 * "@name", a unique start of a name (4+ letters), or one typo in a name of 5+
 * letters. Null when nobody (or more than one player) fits.
 */
export function matchName(raw: unknown, players: readonly NamedPlayer[]): string | null {
  if (typeof raw !== "string") return null;
  const wanted = key(raw);
  if (wanted.length === 0 || wanted.length > 40) return null;
  const exact = players.filter((p) => key(p.name) === wanted);
  if (exact.length === 1) return exact[0]?.id ?? null;
  if (exact.length > 1) return null;
  if (wanted.length >= 4) {
    const prefixed = players.filter((p) => key(p.name).startsWith(wanted));
    if (prefixed.length === 1) return prefixed[0]?.id ?? null;
  }
  if (wanted.length >= 5) {
    const close = players.filter((p) => key(p.name).length >= 5 && levenshtein(key(p.name), wanted) <= 1);
    if (close.length === 1) return close[0]?.id ?? null;
  }
  return null;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MARK = (i: number) => `⟦${i}⟧`;

/**
 * Lower-cases the text and swaps every player's name in it for a marker
 * (⟦index⟧), so the patterns below can find "⟦3⟧ is mafia" whatever the name
 * looks like. Names that are everyday words count only with a capital or an @;
 * one typo is forgiven in names of 5+ letters.
 */
export function markNames(text: string, players: readonly NamedPlayer[]): string {
  // Work on the original text for the capital-letter rule, then fold.
  let out = text.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘`´]/g, "'");
  const order = players.map((p, i) => ({ p, i })).sort((a, b) => b.p.name.length - a.p.name.length);
  for (const { p, i } of order) {
    const name = p.name.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
    if (name.length === 0) continue;
    const common = COMMON_WORDS.has(name.toLowerCase());
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])@?(${escape(name)})(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(pattern, (whole: string, found: string) => {
      if (common && !whole.startsWith("@") && found[0] === found[0]?.toLowerCase()) return whole;
      return ` ${MARK(i)} `;
    });
  }
  // One typo in a longer name.
  out = out.replace(/[\p{L}\p{N}']{5,}/gu, (word) => {
    const folded = word.toLowerCase();
    const close = players
      .map((p, i) => ({ k: key(p.name), i }))
      .filter((c) => c.k.length >= 5 && !c.k.includes(" ") && levenshtein(c.k, folded) === 1);
    return close.length === 1 && close[0] ? ` ${MARK(close[0].i)} ` : word;
  });
  return out.toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- roles

const ROLE_SYNONYMS: Array<[string, Role]> = [
  ["sneaky gang", "mafia"],
  ["mafioso", "mafia"],
  ["mafia", "mafia"],
  ["godfather", "mafia"],
  ["doctor", "doctor"],
  ["doc", "doctor"],
  ["medic", "doctor"],
  ["healer", "doctor"],
  ["detective", "detective"],
  ["investigator", "detective"],
  ["sheriff", "detective"],
  ["cop", "detective"],
  ["seer", "detective"],
  ["villager", "villager"],
  ["townie", "villager"],
  ["townsperson", "villager"],
  ["vanilla", "villager"],
  ["bodyguard", "bodyguard"],
  ["body guard", "bodyguard"],
  ["cupid", "cupid"],
  ["jester", "jester"],
];

const ROLE_ALT = ROLE_SYNONYMS.map(([w]) => escape(w)).join("|");

/** A role from a word ("doc" is the Doctor), or null. */
export function roleFromWord(raw: unknown): Role | null {
  if (typeof raw !== "string") return null;
  const word = key(raw).replace(/^(?:the|a|an)\s+/, "");
  if ((ROLES as readonly string[]).includes(word)) return word as Role;
  return ROLE_SYNONYMS.find(([w]) => w === word)?.[1] ?? null;
}

// ---------------------------------------------------------------- the keyword parser

const N = "⟦(\\d+)⟧";
const GANG = "(?:the\\s+)?(?:mafia|mafioso|sneaky gang|gang|godfather)";
const BAD = `(?:${GANG}|sus|sussy|suspicious|sketchy|shady|lying|a liar|liar|guilty|bad|evil|fishy|fake|dodgy|off|weird|too quiet)`;
const GOOD =
  "(?:innocent|clean|town|good|fine|safe|trustworthy|legit|honest|cleared|not (?:the\\s+)?(?:mafia|gang|sneaky gang|sus|suspicious|lying|a liar|guilty|bad))";
const SOFTEN =
  "(?:(?:so|very|really|super|kinda|kind of|a bit|a little|pretty|totally|definitely|100%|clearly|obviously|probably|maybe|quite|too|way too|def|surely|certainly)\\s+){0,3}";
const SURE = /\b(?:definitely|100|for sure|certain|i know|obviously|clearly|no doubt|guaranteed|absolutely|proof|confirmed|swear)\b|!!/;
const HEDGE = /\b(?:maybe|might|i think|not sure|probably|kinda|kind of|seems|a bit|a little|perhaps|possibly|i guess|hmm|idk|unsure|could be)\b/;
const INVESTIGATED = /\b(?:checked|investigated|looked into|scanned|tested|inspected|i check(?:ed)?|my check|my result|results? (?:on|for)|came back|detective|cop|sheriff)\b/;
const QUESTION_WORDS = "(?:who|what|why|are|do|did|is|can|how|where|when|will|would|should|have|has|whats|what's)";
const QUESTION_WORD = new RegExp(`^${QUESTION_WORDS}\\b`);
/** Not right after "not", "never" or "don't" ("I'm not voting for Sam" isn't a vote for Sam). */
const NOT_NEGATED = "(?<!\\b(?:not|never|don'?t|dont|won'?t|wont)\\s)";

function all(re: RegExp, text: string): RegExpExecArray[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    out.push(m);
    if (m[0].length === 0) global.lastIndex++;
  }
  return out;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the who-said-it fields are added. */
type Draft = DistributiveOmit<Heard, keyof HeardBase>;

/**
 * The keyword reader for when the host's AI is off or doesn't answer: the
 * common ways people make claims, accuse, defend, ask for votes, ask a bot
 * something or point at someone's votes. Names are matched with fuzzy matching.
 */
export function parseMessage(message: HeardSource, players: readonly NamedPlayer[]): Heard[] {
  const t = markNames(message.text, players);
  const idOf = (index: string | undefined) => (index === undefined ? null : (players[Number(index)]?.id ?? null));
  const speaker = message.senderId;
  const drafts: Draft[] = [];
  const add = (d: Draft) => drafts.push(d);
  const sure = SURE.test(t);
  const hedged = HEDGE.test(t);

  // "I'm the Doctor", "doc here", "claiming detective"
  const claim = new RegExp(
    `(?:^|[^a-z])(?:i'?m|i am|im|iam)\\s+(?:(?:the|a|an|just|only|actually|really|literally|obviously|definitely|totally|honestly|real|the real|your)\\s+){0,3}(${ROLE_ALT})\\b|\\b(${ROLE_ALT})\\s+here\\b|\\bclaim(?:ing)?\\s+(?:to be\\s+)?(?:the\\s+|a\\s+)?(${ROLE_ALT})\\b`,
  );
  const claimMatch = claim.exec(t);
  const claimedRole = claimMatch ? roleFromWord(claimMatch[1] ?? claimMatch[2] ?? claimMatch[3]) : null;
  if (claimedRole) add({ kind: "role_claim", role: claimedRole });

  // A Detective's result: "I checked ⟦2⟧, they're mafia", "⟦2⟧ came back clean"
  const resultTargets = new Set<string>();
  if (INVESTIGATED.test(t) || claimedRole === "detective") {
    const resultPatterns = [
      new RegExp(`(?:checked|investigated|looked into|scanned|tested|inspected|check(?:ed)? on)\\s+${N}[^.!?]*?\\b(${GANG}|bad|evil|guilty|${GOOD})`),
      new RegExp(`${N}\\s+(?:is|was|came back|came up|showed up|shows|showed|=|:|-)\\s*(?:as\\s+)?(?:a\\s+|an\\s+|the\\s+)?${SOFTEN}(${GANG}|bad|evil|guilty|${GOOD})`),
    ];
    for (const re of resultPatterns) {
      for (const m of all(re, t)) {
        const target = idOf(m[1]);
        const verdict = m[2] ?? "";
        if (!target || target === speaker || resultTargets.has(target)) continue;
        const innocent = new RegExp(`^${GOOD}$`).test(verdict);
        const night = /night\s+(\d+)/.exec(t)?.[1];
        resultTargets.add(target);
        add({ kind: "result_claim", targetId: target, result: innocent ? "innocent" : "mafia", night: night ? Number(night) : null });
      }
    }
  }

  // Votes as evidence: "⟦1⟧ voted for ⟦3⟧"
  const evidence = new Set<string>();
  for (const m of all(new RegExp(`${N}\\s+(?:voted|votes|was voting|has been voting|keeps voting)\\s+(?:for\\s+|against\\s+|out\\s+|to\\s+\\w+\\s+)?${N}`), t)) {
    const about = idOf(m[1]);
    const votedFor = idOf(m[2]);
    if (about && votedFor && about !== votedFor) {
      add({ kind: "vote_evidence", aboutId: about, votedForId: votedFor });
      evidence.add(about);
    }
  }
  for (const m of all(new RegExp(`${N}'?s?\\s+votes?\\s+(?:on|for|against)\\s+${N}`), t)) {
    const about = idOf(m[1]);
    const votedFor = idOf(m[2]);
    if (about && votedFor && about !== votedFor) {
      add({ kind: "vote_evidence", aboutId: about, votedForId: votedFor });
      evidence.add(about);
    }
  }
  const pointsAtClaims = /\b(?:claimed|claims|said (?:they|he|she) (?:was|were|is)|story|lied|lying about|both claim)\b/.test(t);

  // Accusations
  const accused = new Map<string, boolean>();
  const accusePatterns: Array<[RegExp, "plain" | "strong"]> = [
    [new RegExp(`${N}\\s+(?:is|'s|seems|looks|feels|sounds|is acting|acts|acting|has been|was|been|is being)\\s+${SOFTEN}(?:a\\s+|an\\s+)?${BAD}`), "plain"],
    [new RegExp(`(?:don'?t|do not|can'?t|cannot|never|wouldn'?t)\\s+trust\\s+${N}`), "plain"],
    [new RegExp(`${NOT_NEGATED}(?:suspect|blame|accuse|sus on|suspicious of|suspicious about|sus of|eyes on|watching|watch out for)\\s+${N}`), "plain"],
    [new RegExp(`(?:it'?s|its|it is|gotta be|has to be|must be|got to be)\\s+(?:(?:definitely|totally|obviously|clearly|probably|so)\\s+)?${N}(?!\\s*(?:and|or|'s|is))`), "strong"],
    [new RegExp(`(?:i\\s+(?:think|bet|reckon|guess|feel like|believe)|my guess is|my money'?s on|i'?m going with|going with)\\s+(?:it'?s\\s+)?${N}(?!\\s+(?:is\\s+)?${GOOD})`), "plain"],
    [new RegExp(`${N}\\s+(?:did it|is lying|lied|is one of them|is the bad guy)`), "strong"],
    [new RegExp(`${N}\\s+sus\\b|\\bsus\\s+${N}`), "plain"],
  ];
  for (const [re, strength] of accusePatterns) {
    for (const m of all(re, t)) {
      const target = idOf(m[1]);
      if (!target || target === speaker || resultTargets.has(target)) continue;
      const gangWord = new RegExp(GANG).test(m[0]) || /lying|liar|lied|did it/.test(m[0]);
      const confident = sure || ((strength === "strong" || gangWord) && !hedged);
      accused.set(target, (accused.get(target) ?? false) || confident);
    }
  }
  for (const [target, confident] of accused) {
    add({ kind: "accuse", targetId: target, confident, evidence: evidence.has(target) ? "votes" : pointsAtClaims ? "claim" : null });
  }

  // Defences
  const defended = new Set<string>();
  const defendPatterns = [
    new RegExp(`${N}\\s+(?:is|'s|seems|looks|is definitely|was)\\s+${SOFTEN}${GOOD}`),
    new RegExp(`\\bi\\s+(?:trust|believe|vouch for|believe in)\\s+${N}`),
    new RegExp(`(?:leave|lay off|stop accusing|stop blaming)\\s+${N}`),
    new RegExp(`(?:it'?s|its)\\s+not\\s+${N}`),
    new RegExp(`${N}\\s+(?:is|'s)\\s+(?:with|on)\\s+(?:us|me|our side|the town)`),
  ];
  for (const re of defendPatterns) {
    for (const m of all(re, t)) {
      const target = idOf(m[1]);
      if (!target || resultTargets.has(target) || accused.has(target)) continue;
      defended.add(target);
    }
  }
  if (/(?:it'?s\s+not\s+me|\bnot me\b|i'?m\s+innocent|i'?m\s+not\s+(?:the\s+)?(?:mafia|gang|sneaky gang|guilty|lying|bad)|i'?m\s+(?:on the\s+)?town\b|i didn'?t do (?:it|anything)|i swear)/.test(t)) {
    defended.add(speaker);
  }
  for (const target of defended) add({ kind: "defend", targetId: target });

  // Alliances
  for (const re of [
    new RegExp(`${N}\\s+and\\s+(?:i|me)\\s+(?:trust each other|are (?:allies|a team|together|town|friends|on the same side|good|confirmed|working together))`),
    new RegExp(`(?:me|i)\\s+and\\s+${N}\\s+(?:are|trust)`),
    new RegExp(`(?:i'?m|we'?re|i am)\\s+(?:with|teaming(?: up)? with|allied with|siding with)\\s+${N}`),
  ]) {
    for (const m of all(re, t)) {
      const other = idOf(m[1]);
      if (other && other !== speaker) add({ kind: "alliance", withId: other });
    }
  }

  // Who the message is addressed to ("@Mia ...", "Mia, ...", "..., Mia?")
  const addressed = (() => {
    // "@Name" anywhere (markNames folds the @ away, so look in the original text).
    const raw = /@([\p{L}\p{N}_'-]{2,30})/u.exec(message.text);
    const atName = raw ? matchName(raw[1], players) : null;
    if (atName) return atName;
    const at = new RegExp(
      `^${N}\\s*[,:]|^${N}\\s+(?=${QUESTION_WORDS}\\b)|^(?:hey|hi|yo|ok|okay|so|and|oi)\\s+${N}|,\\s*${N}\\s*\\?\\s*$|${N}\\s*\\?\\s*$`,
    ).exec(t);
    const index = at?.slice(1).find((g) => g !== undefined);
    return index !== undefined ? idOf(index) : null;
  })();

  // Vote requests
  const voteTarget = new RegExp(
    `${NOT_NEGATED}(?:vote|voting|vote for|vote out|lynch|eliminate|kick out|send home|get rid of|go for|let'?s get|everyone vote|all vote|vote off|voting for)\\s+(?:for\\s+|out\\s+|off\\s+)?${N}`,
  );
  const requested = new Set<string>();
  for (const m of all(voteTarget, t)) {
    const target = idOf(m[1]);
    if (!target || target === speaker || requested.has(target)) continue;
    requested.add(target);
    add({ kind: "vote_request", targetId: target, toId: addressed !== target ? addressed : null });
  }
  if (/\b(?:vote\s+skip|let'?s skip|we should skip|everyone skip|skip (?:the|this) vote|no elimination)\b/.test(t)) {
    add({ kind: "vote_request", targetId: SKIP, toId: addressed });
  }

  // A question to one player
  const isQuestion =
    t.includes("?") || QUESTION_WORD.test(t.replace(new RegExp(`^${N}\\s*[,:]?\\s*`), "")) || /\b(?:tell|show) (?:me|us)\b/.test(t);
  if (isQuestion && addressed && addressed !== speaker) {
    let about: QuestionTopic = "general";
    if (/\b(?:role|what are you|who are you|are you (?:the|a|an)\b|claim|what'?s your (?:role|job)|you the\b|are you town|are you mafia|are you gang)/.test(t)) about = "role";
    else if (
      /who\s+(?:do you|d'?you|would you|is|'s)\s+(?:think|suspect|sus|mafia)|who'?s (?:the\s+)?(?:mafia|gang|sus)|your (?:suspect|guess|pick|read)|who (?:are|is) (?:the\s+)?(?:mafia|gang)|who\s+(?:the\s+)?(?:mafia|gang)\s+(?:are|is)|who do you suspect|tell me who/.test(t)
    ) about = "suspect";
    else if (/\b(?:who (?:are|r) you voting|who will you vote|why did you vote|why'?d you vote|your vote|voting for|vote for\?)/.test(t)) about = "vote";
    add({ kind: "question", toId: addressed, about });
  }

  const base: HeardBase = { messageId: message.id, speakerId: speaker, at: message.sentAt, byBot: false, replyTo: null };
  return dedupe(drafts).map((d) => ({ ...base, ...d }) as Heard);
}

function dedupe(drafts: Draft[]): Draft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const k = JSON.stringify(d);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- what the host's AI reported

const MAX_AI_EVENTS = 40;
const MAX_PER_MESSAGE = 6;

const mentionedIn = (text: string, id: string, players: readonly NamedPlayer[]) => {
  const index = players.findIndex((p) => p.id === id);
  return index >= 0 && markNames(text, players).includes(MARK(index));
};

/**
 * Checks what the host's AI reported about a batch of messages. Each event
 * must name a message of the batch ("msg"); the speaker is that message's
 * author, whatever the AI said. Every name must match a real player and
 * appear in that message. Unknown types and fields are dropped.
 */
export function validateAiHeard(
  raw: unknown,
  batch: ReadonlyArray<{ n: number; message: HeardSource }>,
  players: readonly NamedPlayer[],
): Heard[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { events?: unknown }).events : null;
  if (!Array.isArray(list)) return [];
  const out: Draft[] = [];
  const sources: Array<{ draft: Draft; message: HeardSource }> = [];
  const perMessage = new Map<number, number>();

  for (const item of list.slice(0, MAX_AI_EVENTS * 2)) {
    if (sources.length >= MAX_AI_EVENTS) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const type = typeof r.type === "string" ? r.type : "";
    if (!(HEARD_TYPES as readonly string[]).includes(type)) continue;
    const entry = batch.find((b) => b.n === r.msg || String(b.n) === r.msg);
    if (!entry) continue;
    const used = perMessage.get(entry.n) ?? 0;
    if (used >= MAX_PER_MESSAGE) continue;
    const message = entry.message;
    const speaker = message.senderId;
    // A name only counts if it really is in the message (the AI can't make up who was named).
    const named = (value: unknown): string | null => {
      const id = matchName(value, players);
      return id && mentionedIn(message.text, id, players) ? id : null;
    };
    let draft: Draft | null = null;
    switch (type as HeardType) {
      case "role_claim": {
        const role = roleFromWord(r.role);
        if (role && new RegExp(`\\b(?:${ROLE_ALT})\\b`).test(foldText(message.text))) draft = { kind: "role_claim", role };
        break;
      }
      case "result_claim": {
        const target = named(r.target);
        const result = r.result === "mafia" || r.result === "guilty" ? "mafia" : r.result === "innocent" || r.result === "clean" ? "innocent" : null;
        const night = typeof r.night === "number" && Number.isInteger(r.night) && r.night >= 1 && r.night <= 50 ? r.night : null;
        if (target && result && target !== speaker) draft = { kind: "result_claim", targetId: target, result, night };
        break;
      }
      case "accuse": {
        const target = named(r.target);
        const evidence = r.evidence === "votes" || r.evidence === "claim" ? r.evidence : null;
        if (target && target !== speaker) draft = { kind: "accuse", targetId: target, confident: r.confident === true, evidence };
        break;
      }
      case "defend": {
        const target = matchName(r.target, players) === speaker ? speaker : named(r.target);
        if (target) draft = { kind: "defend", targetId: target };
        break;
      }
      case "vote_request": {
        const skip = typeof r.target === "string" && key(r.target) === "skip";
        const target = skip ? SKIP : named(r.target);
        const to = r.to === null || r.to === undefined ? null : named(r.to);
        if (target && target !== speaker) draft = { kind: "vote_request", targetId: target, toId: to };
        break;
      }
      case "question": {
        const to = named(r.to);
        const about = (QUESTION_TOPICS as readonly string[]).includes(r.about as string) ? (r.about as QuestionTopic) : "general";
        if (to && to !== speaker) draft = { kind: "question", toId: to, about };
        break;
      }
      case "alliance": {
        const other = named(r.with);
        if (other && other !== speaker) draft = { kind: "alliance", withId: other };
        break;
      }
      case "vote_evidence": {
        const about = named(r.about);
        const votedFor = named(r.voted_for ?? r.votedFor);
        if (about && votedFor && about !== votedFor) draft = { kind: "vote_evidence", aboutId: about, votedForId: votedFor };
        break;
      }
    }
    if (!draft) continue;
    perMessage.set(entry.n, used + 1);
    sources.push({ draft, message });
    out.push(draft);
  }

  const seen = new Set<string>();
  const events: Heard[] = [];
  for (const { draft, message } of sources) {
    const k = `${message.id}:${JSON.stringify(draft)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    events.push({ messageId: message.id, speakerId: message.senderId, at: message.sentAt, byBot: false, replyTo: null, ...draft } as Heard);
  }
  return events;
}

// ---------------------------------------------------------------- what a bot said

/** The events a bot's posted message stands for, straight from its intent (no reading needed). */
export function heardFromIntent(intent: BotIntent, botId: string, messageId: string, at: number): Heard[] {
  const base: HeardBase = { messageId, speakerId: botId, at, byBot: true, replyTo: intent.replyToMessageId ?? null };
  const target = intent.targetId;
  const drafts: Draft[] = [];
  switch (intent.act) {
    case "claim_role":
      if (intent.role) drafts.push({ kind: "role_claim", role: intent.role });
      break;
    case "claim_result":
      drafts.push({ kind: "role_claim", role: "detective" });
      if (target && intent.result) drafts.push({ kind: "result_claim", targetId: target, result: intent.result, night: intent.night ?? null });
      break;
    case "counter_claim":
      if (intent.role) drafts.push({ kind: "role_claim", role: intent.role });
      if (target) drafts.push({ kind: "accuse", targetId: target, confident: true, evidence: "claim" });
      break;
    case "accuse":
      if (target) {
        const evidence = intent.reason === "votes" ? "votes" : intent.reason === "claim" ? "claim" : null;
        drafts.push({ kind: "accuse", targetId: target, confident: intent.tone === "confident" || intent.tone === "angry", evidence });
      }
      break;
    case "agree":
    case "deflect":
      if (target) drafts.push({ kind: "accuse", targetId: target, confident: false, evidence: null });
      break;
    case "defend_self":
      drafts.push({ kind: "defend", targetId: botId });
      break;
    case "defend_other":
      if (target) drafts.push({ kind: "defend", targetId: target });
      break;
    case "trust":
      if (target) drafts.push({ kind: "defend", targetId: target }, { kind: "alliance", withId: target });
      break;
    case "vote_call":
      if (target) drafts.push({ kind: "vote_request", targetId: target, toId: null });
      break;
    case "question":
      if (target) drafts.push({ kind: "question", toId: target, about: intent.topic ?? "general" });
      break;
    case "call_out":
      if (target && intent.contradiction) {
        drafts.push({ kind: "call_out", targetId: target, contradiction: intent.contradiction, aboutId: intent.aboutId ?? null });
        drafts.push({ kind: "accuse", targetId: target, confident: true, evidence: "claim" });
      }
      break;
    default:
      break;
  }
  return drafts.map((d) => ({ ...base, ...d }) as Heard);
}
