import type { ContentMode } from "./game.js";

/**
 * Words each content mode keeps out of the narrator's text. The server checks
 * every AI-written line against these before anyone sees it, and the client's
 * tests check that Safe Mode's own wording stays clean.
 *
 * An entry ending in * matches any ending ("kill*" finds kill, killed, killer);
 * everything else must match a whole word ("body" must not catch "everybody").
 */

/**
 * Safe Mode: no weapons, death, blood or violence words at all. Players leave
 * the game in cartoony ways (sent home, whisked away, a surprise holiday).
 */
export const SAFE_BANNED_WORDS: readonly string[] = [
  // killing and death
  "kill*", "murder*", "slay*", "slain", "slaughter*", "assassin*", "execut*", "eliminat*",
  "die", "dies", "died", "dying", "dead", "death*", "deadly", "deceased", "perish*", "fatal*", "lethal",
  "corpse*", "cadaver*", "body", "bodies", "grave", "graves", "graveyard*", "gravestone*", "tomb", "tombs", "tombstone*", "coffin*", "funeral*", "burial", "skull*",
  // blood and injury
  "blood*", "bleed*", "gore", "gory", "wound*", "injur*", "hurt*", "harm", "harms", "harmed", "harming",
  // weapons
  "stab", "stabs", "stabbed", "stabbing", "shot", "shots", "shoot*", "gun*", "rifle*", "pistol*", "revolver*", "firearm*", "bullet*", "ammo",
  "knife", "knives", "dagger*", "sword*", "blade", "blades", "axe", "axes", "hatchet*", "machete*", "chainsaw*",
  "weapon*", "bomb*", "explosi*", "explod*", "grenade*", "dynamite", "spear*", "trigger",
  // ways to hurt someone
  "poison*", "venom*", "toxic*", "strangl*", "chok*", "drown*", "suffocat*", "noose", "gallows", "guillotine*",
  "behead*", "decapitat*",
  // fighting and crime
  "fight*", "fought", "attack*", "assault*", "violen*", "brutal*", "punch*", "war", "wars", "warfare", "battle*",
  "victim*", "terror*", "horrif*", "horror*", "crime*", "criminal*", "gangster*", "thug*",
];

/**
 * Normal Mode: crime-drama is welcome (shot, poisoned, found at the docks) but
 * no gore or graphic injury, no sexual content, and nothing that encourages
 * self-harm. Slurs and profanity are caught separately by containsProfanity.
 */
export const NORMAL_BANNED_WORDS: readonly string[] = [
  // gore and graphic injury
  "gore", "gory", "gored", "guts", "gutted", "entrails", "intestine*", "innards", "viscera", "dismember*",
  "decapitat*", "beheading", "beheaded", "mutilat*", "disembowel*", "eviscerat*", "maim*", "severed", "amputat*",
  "flayed", "scalped", "bloodbath", "blood-soaked", "bloodsoaked", "gushing", "spurting", "oozing", "brain-matter",
  "torture*", "tortur*",
  // sexual content
  "rape*", "rapist*", "molest*", "sex", "sexy", "sexual*", "nude", "naked", "porn*", "erotic*", "orgasm*",
  "genital*", "penis", "vagina", "breast*", "nipple*", "fetish*", "incest",
  // self-harm and atrocities
  "suicide*", "self-harm", "genocide*", "holocaust", "lynch*",
];

const WORD = "[a-z0-9]";

function compile(words: readonly string[]): RegExp {
  const parts = words.map((entry) => {
    const stem = entry.endsWith("*") ? entry.slice(0, -1) : entry;
    const escaped = stem.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    return entry.endsWith("*") ? `${escaped}${WORD}*` : escaped;
  });
  return new RegExp(`(?<!${WORD})(?:${parts.join("|")})(?!${WORD})`, "g");
}

const PATTERNS: Record<ContentMode, RegExp> = {
  safe: compile(SAFE_BANNED_WORDS),
  normal: compile(NORMAL_BANNED_WORDS),
};

/** Lower-case, accent-free text, so "KILLED" and "kíll" are found the same way. */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'");
}

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Undoes common letter-for-digit swaps ("k1ll" -> "kill"). */
function foldLeet(text: string): string {
  return text.replace(/[013457@$]/g, (ch) => LEET[ch] ?? ch);
}

/**
 * The first banned word in `text` for this mode, or null if there is none.
 * Also catches simple tricks: capital letters, accents and digits for letters.
 */
export function findBannedWord(text: string, mode: ContentMode): string | null {
  const pattern = PATTERNS[mode];
  const folded = foldText(text);
  for (const candidate of [folded, foldLeet(folded)]) {
    pattern.lastIndex = 0;
    const match = pattern.exec(candidate);
    if (match) return match[0];
  }
  return null;
}
