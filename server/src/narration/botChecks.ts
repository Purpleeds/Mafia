import {
  BOT_LINE_MAX_LENGTH,
  containsLink,
  containsProfanity,
  filterChatText,
  findBannedWord,
  hasEmoji,
  type ContentMode,
  type GangName,
  type Role,
  type SpeechIntent,
} from "@mafia/shared";
import { MARKUP, maskNames, nameRegExp, tidyNarration } from "./checks.js";

/**
 * The checks every bot message the host's AI wrote must pass before anyone
 * sees it: the same rules as the narrator (the mode's word list, length, no
 * emoji, no links, no markup), and it must say what the intent says: the
 * right names, no other players, no role the intent doesn't mention. If it
 * fails, the server posts the intent's ready-made line instead.
 */
export type BotLineRejection =
  | "empty"
  | "too_long"
  | "markup"
  | "banned_word"
  | "profanity"
  | "emoji"
  | "missing_name"
  | "other_name"
  | "role_word"
  | "missing_role"
  | "missing_result"
  | "meaning_flipped";

export type BotLineCheck = { ok: true; text: string } | { ok: false; reason: BotLineRejection };

export interface BotLineContext {
  mode: ContentMode;
  gang: GangName;
  /** The intent the message was written for (names, as sent to the AI). */
  intent: SpeechIntent;
  /** Everyone in the room by name: no other player may be named. */
  names: readonly string[];
}

const reject = (reason: BotLineRejection): BotLineCheck => ({ ok: false, reason });

/** Words for each role (the AI may use a few everyday ones). */
const ROLE_PATTERNS: Record<Role, string> = {
  mafia: "mafia|mafioso|sneaky gang|gang",
  doctor: "doctors?|docs?|medics?|healers?",
  detective: "detectives?|cops?|investigators?|sheriffs?",
  villager: "villagers?|townies?|townsperson|townsfolk",
  bodyguard: "bodyguards?|body guards?",
  cupid: "cupids?",
  jester: "jesters?",
};

const roleRe = (role: Role) => new RegExp(`(?<![a-z0-9])(?:${ROLE_PATTERNS[role]})(?![a-z0-9])`, "i");

/** The roles an intent itself names, so a message for it may name them too. */
function allowedRoles(intent: SpeechIntent): Set<Role> {
  const allowed = new Set<Role>();
  if (intent.role) allowed.add(intent.role);
  switch (intent.act) {
    case "claim_result":
      allowed.add("detective");
      if (intent.result === "mafia") allowed.add("mafia");
      break;
    case "call_out":
      // "…said Lee was Mafia, but Lee was the Doctor": the gang word goes with any false result.
      allowed.add("mafia");
      break;
    case "counter_claim":
      allowed.add("mafia");
      break;
    case "accuse":
    case "agree":
    case "deflect":
    case "vote_call":
    case "question":
    case "defend_self":
    case "defend_other":
    case "trust":
    case "jester":
    case "chatter":
    case "react_death":
    case "dodge":
      // Saying someone is (or isn't) Mafia is ordinary suspicion, not a claim about a role.
      allowed.add("mafia");
      break;
    case "claim_role":
      break;
  }
  return allowed;
}

const INNOCENT = /(?<![a-z0-9])(?:innocent|clean|cleared|good|safe|town|not\s+(?:the\s+)?(?:mafia|gang|sneaky gang|guilty))(?![a-z0-9])/i;
const FLIPPED_ACCUSATION = /(?:it'?s not|isn'?t|is not|wasn'?t)\s+§|§\s+(?:is|'s|was|seems)\s+(?:so\s+|very\s+|totally\s+|definitely\s+)?(?:innocent|clean|trustworthy|not\s+(?:the\s+)?(?:mafia|gang))/i;

/** The message, tidied, if it is fit to post for this intent. */
export function checkBotLine(raw: unknown, ctx: BotLineContext): BotLineCheck {
  if (typeof raw !== "string") return reject("empty");
  const { intent } = ctx;
  let text = tidyNarration(raw);
  // "Mia: I don't trust Sam" -> the name prefix goes.
  const prefix = new RegExp(`^\\s*${intent.bot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i");
  text = text.replace(prefix, "").trim();
  if (text.length === 0) return reject("empty");
  if ([...text].length > BOT_LINE_MAX_LENGTH) return reject("too_long");
  if ((text.match(/[.!?]+(?:\s|$)/g) ?? []).length > 3) return reject("too_long");
  if (hasEmoji(text)) return reject("emoji");

  // The intent's players must be named; nobody else may be.
  const required = [intent.target, ...(intent.act === "call_out" || intent.reason === "votes" || intent.reason === "defended" ? [intent.about] : [])].filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );
  for (const name of required) if (!nameRegExp(name, "iu").test(text)) return reject("missing_name");
  const allowedNames = [intent.bot, intent.target, intent.about, intent.replyTo?.from].filter((n): n is string => !!n);
  const masked = maskNames(text, allowedNames, "§");
  const allowedKeys = new Set(allowedNames.map((n) => n.toLowerCase()));
  for (const name of ctx.names) {
    if ([...name].length < 3 || allowedKeys.has(name.toLowerCase())) continue;
    if (nameRegExp(name, "iu").test(masked)) return reject("other_name");
  }

  if (MARKUP.test(masked) || containsLink(masked)) return reject("markup");
  if (findBannedWord(masked, ctx.mode) !== null) return reject("banned_word");
  // Nothing the strictest chat filter would hide: no swearing, and no "idiot" or "stupid" either.
  if (containsProfanity(masked) || filterChatText(masked, "strict") !== masked) return reject("profanity");

  // No role the intent doesn't name (a message can't start claiming things on its own).
  const allowed = allowedRoles(intent);
  for (const role of Object.keys(ROLE_PATTERNS) as Role[]) {
    if (!allowed.has(role) && roleRe(role).test(masked)) return reject("role_word");
  }

  // What the intent is for must be in it.
  if ((intent.act === "claim_role" || intent.act === "counter_claim") && intent.role && !roleRe(intent.role).test(masked)) return reject("missing_role");
  if (intent.act === "claim_result") {
    const said = intent.result === "mafia" ? roleRe("mafia").test(masked) : INNOCENT.test(masked);
    if (!said) return reject("missing_result");
  }
  if ((intent.act === "accuse" || intent.act === "agree" || intent.act === "vote_call" || intent.act === "deflect") && intent.target) {
    const targetOnly = maskNames(text, [intent.target], "§");
    if (FLIPPED_ACCUSATION.test(targetOnly)) return reject("meaning_flipped");
  }
  return { ok: true, text };
}
