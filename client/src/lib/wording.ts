/**
 * Every word that changes with the content mode or with the host's choice to
 * call the Mafia "the Sneaky Gang". Screens ask here instead of hard-coding
 * "Mafia" or "eliminated", so Safe Mode never shows a violent word and the
 * rename reaches every corner (role cards, results, help, chat).
 *
 * The rules never change between modes, only the words.
 */
import { gangName, type ContentMode, type DeathCause, type GameSettings, type GangName, type Role, type Team, type TieRule, type Winner } from "@mafia/shared";
import type { IconName } from "../art/icons";

export type WordingSettings = Pick<GameSettings, "contentMode" | "sneakyGang">;

/** For screens outside a room (the how-to-play page): Safe Mode, the Mafia under their usual name. */
export const OUTSIDE_A_ROOM: WordingSettings = { contentMode: "safe", sneakyGang: false };

/** "Mafia", or "Sneaky Gang" when the host chose the friendlier name in Safe Mode. */
export function gangOf(settings: WordingSettings): GangName {
  return gangName(settings);
}

/** Fills {gang} (Mafia), {theGang} (the Mafia) and {TheGang} (The Mafia) in a piece of text. */
export function fill(text: string, settings: WordingSettings): string {
  const gang = gangOf(settings);
  return text.replaceAll("{TheGang}", `The ${gang}`).replaceAll("{theGang}", `the ${gang}`).replaceAll("{gang}", gang);
}

const ROLE_NAME: Record<Exclude<Role, "mafia">, string> = {
  doctor: "Doctor",
  detective: "Detective",
  villager: "Villager",
  jester: "Jester",
  bodyguard: "Bodyguard",
  cupid: "Cupid",
};

export function roleLabel(role: Role, settings: WordingSettings): string {
  return role === "mafia" ? gangOf(settings) : ROLE_NAME[role];
}

export function teamLabel(team: Team, settings: WordingSettings): string {
  if (team === "mafia") return gangOf(settings);
  return team === "town" ? "Town" : "Loner";
}

export function winnerLabel(winner: Winner, settings: WordingSettings): string {
  if (winner === "mafia") return `The ${gangOf(settings)} wins!`;
  return winner === "town" ? "The Town wins!" : "The Jester wins!";
}

/** Whether someone is, or isn't, in the Mafia (the Detective's answer). */
export function isGangMember(isMafia: boolean, settings: WordingSettings): string {
  const gang = gangOf(settings);
  return isMafia ? gang : `not ${gang}`;
}

interface ModeWords {
  /** Tag on someone who has left the game. */
  outTag: string;
  outIcon: IconName;
  /** Banner for a player who has left, still watching. */
  outBanner: string;
  outBannerNight: string;
  /** The chat that players who have left share with spectators. */
  outChatTab: string;
  outChatPlaceholder: string;
  outChatEmpty: string;
  outChatNote: string;
  /** Shown in place of a death's cause: how they left. */
  cause: Record<DeathCause, { icon: IconName; text: string }>;
  tieNone: string;
  revealLabel: string;
  revealHint: string;
  revealSummary: string;
  tieRule: Record<TieRule, string>;
  /** After "Nobody ..." in the timeline: what happened to the Mafia's pick. */
  outcome: { no_attack: string; saved: string; guarded: string; killed: string };
  /** The timeline's "went after" line. */
  wentAfter: string;
  /** The label of the night's choice buttons for Mafia ("Send home" / "Eliminate"). */
  mafiaVerb: string;
}

const SAFE: ModeWords = {
  outTag: "Sent home",
  outIcon: "home",
  outBanner:
    "You've been sent home. You can still watch and chat with the others at home, but you can't talk to the players still in the game or vote.",
  outBannerNight: "You've been sent home. You can watch from here.",
  outChatTab: "Back Home",
  outChatPlaceholder: "Message everyone at home",
  outChatEmpty: "Only players who have gone home, and spectators, see this.",
  outChatNote: "Players who have gone home can watch, but can't talk to the others. Use the Back Home tab.",
  cause: {
    mafia: { icon: "moon", text: "Sent home by {theGang}" },
    vote: { icon: "ballot", text: "Sent home by the town" },
    heartbreak: { icon: "brokenHeart", text: "Went home with a broken heart" },
  },
  tieNone: "Nobody goes home",
  revealLabel: "Reveal roles when players go home",
  revealHint: "Everyone sees a player's role when they go home.",
  revealSummary: "Roles when going home",
  tieRule: { no_elimination: "Nobody goes home", revote: "Revote between the tied players" },
  outcome: {
    no_attack: "{TheGang} didn't pick anyone.",
    saved: "The Doctor saved them.",
    guarded: "The Bodyguard took their place.",
    killed: "They were sent home.",
  },
  wentAfter: "{TheGang} picked",
  mafiaVerb: "Send home",
};

const NORMAL: ModeWords = {
  outTag: "Eliminated",
  outIcon: "grave",
  outBanner:
    "You've been eliminated. You can watch and use the graveyard chat, but you can't talk to the living or vote.",
  outBannerNight: "You've been eliminated. You can watch from here.",
  outChatTab: "Graveyard",
  outChatPlaceholder: "Message the graveyard",
  outChatEmpty: "Only eliminated players and spectators see this.",
  outChatNote: "Eliminated players can watch, but can't talk to the living. Use the Graveyard tab.",
  cause: {
    mafia: { icon: "moon", text: "Killed in the night" },
    vote: { icon: "ballot", text: "Voted out" },
    heartbreak: { icon: "brokenHeart", text: "Died of a broken heart" },
  },
  tieNone: "Nobody is eliminated",
  revealLabel: "Reveal roles on elimination",
  revealHint: "Everyone sees an eliminated player's role.",
  revealSummary: "Roles on elimination",
  tieRule: { no_elimination: "Nobody is eliminated", revote: "Revote between the tied players" },
  outcome: {
    no_attack: "The Mafia didn't pick anyone.",
    saved: "The Doctor saved them.",
    guarded: "The Bodyguard took the hit.",
    killed: "They were eliminated.",
  },
  wentAfter: "The Mafia went after",
  mafiaVerb: "Eliminate",
};

const WORDS: Record<ContentMode, ModeWords> = { safe: SAFE, normal: NORMAL };

/** The mode's wording for people who have left the game, causes, timeline lines and settings. */
export function wordsFor(settings: WordingSettings): ModeWords {
  return WORDS[settings.contentMode];
}

export function deathCause(cause: DeathCause, settings: WordingSettings): { icon: IconName; text: string } {
  const entry = wordsFor(settings).cause[cause];
  return { icon: entry.icon, text: fill(entry.text, settings) };
}

export function tieRuleLabel(rule: TieRule, settings: WordingSettings): string {
  return wordsFor(settings).tieRule[rule];
}

export function nightOutcomeLabel(outcome: keyof ModeWords["outcome"], settings: WordingSettings): string {
  return fill(wordsFor(settings).outcome[outcome], settings);
}

/** "Ana was sent home by the Mafia." / "Ana was eliminated by the Mafia." for the game-over timeline. */
export function timelineDeath(
  who: string,
  roleSuffix: string,
  cause: DeathCause,
  settings: WordingSettings,
): string {
  const safe = settings.contentMode === "safe";
  switch (cause) {
    case "heartbreak":
      return safe ? `${who}${roleSuffix} went home with a broken heart.` : `${who}${roleSuffix} died of a broken heart.`;
    case "vote":
      return safe ? `${who}${roleSuffix} was sent home by the town's vote.` : `${who}${roleSuffix} was voted out.`;
    case "mafia":
      return safe
        ? `${who}${roleSuffix} was sent home by ${`the ${gangOf(settings)}`}.`
        : `${who}${roleSuffix} was eliminated by the Mafia.`;
  }
}
