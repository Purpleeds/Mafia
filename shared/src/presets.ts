/**
 * Ready-made game setups the host can pick in the lobby. A preset sets the
 * rules side of the settings (Mafia count, extra roles, timers, vote and reveal
 * rules) and never the content mode, the Sneaky Gang name, the chat filter or
 * the AI narrator, so every preset works the same in Safe and Normal Mode.
 */
import { MIN_PLAYERS, OPTIONAL_ROLES, defaultSettings, type GameSettings, type OptionalRole, type SettingsPatch } from "./game.js";

export const PRESET_IDS = ["classic", "quick", "chaos"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** The settings a preset decides, all of them, so applying one always gives the same game. */
export type PresetSettings = Pick<
  GameSettings,
  "mafiaCount" | "optionalRoles" | "timers" | "tieRule" | "revealRoleOnDeath" | "showVotes" | "announceSaves"
>;

export interface GamePreset {
  id: PresetId;
  name: string;
  /** Mode-neutral. "{gang}" is the Mafia's name in this room. */
  description: string;
  /** Fewest players this preset can start with. */
  minPlayers: number;
  settings: PresetSettings;
}

const allRoles = (on: boolean): Record<OptionalRole, boolean> =>
  Object.fromEntries(OPTIONAL_ROLES.map((r) => [r, on])) as Record<OptionalRole, boolean>;

const classicDefaults = defaultSettings();

export const PRESETS: Record<PresetId, GamePreset> = {
  classic: {
    id: "classic",
    name: "Classic",
    description: "The standard game: the Doctor, the Detective and {theGang}, with relaxed timers and roles shown when players leave.",
    minPlayers: MIN_PLAYERS,
    settings: {
      mafiaCount: "auto",
      optionalRoles: allRoles(false),
      timers: { ...classicDefaults.timers },
      tieRule: "no_elimination",
      revealRoleOnDeath: true,
      showVotes: true,
      announceSaves: true,
    },
  },
  quick: {
    id: "quick",
    name: "Quick game",
    description: "Short timers for a fast round: 45 seconds to talk, 25 to vote. Great when you only have ten minutes.",
    minPlayers: MIN_PLAYERS,
    settings: {
      mafiaCount: "auto",
      optionalRoles: allRoles(false),
      timers: {
        roleRevealSeconds: 8,
        nightSeconds: 20,
        nightResultsSeconds: 6,
        discussionSeconds: 45,
        votingSeconds: 25,
        voteResultsSeconds: 6,
      },
      tieRule: "no_elimination",
      revealRoleOnDeath: true,
      showVotes: true,
      announceSaves: true,
    },
  },
  chaos: {
    id: "chaos",
    name: "Chaos",
    description:
      "Every special role at once: the Jester, the Bodyguard and Cupid join in. Votes are secret, roles stay hidden when players leave, and ties go to a revote.",
    minPlayers: MIN_PLAYERS + 1,
    settings: {
      mafiaCount: "auto",
      optionalRoles: allRoles(true),
      timers: {
        roleRevealSeconds: 12,
        nightSeconds: 35,
        nightResultsSeconds: 10,
        discussionSeconds: 150,
        votingSeconds: 50,
        voteResultsSeconds: 10,
      },
      tieRule: "revote",
      revealRoleOnDeath: false,
      showVotes: false,
      announceSaves: false,
    },
  },
};

/** The settings change that applies a preset (sent as one host:updateSettings). */
export function presetPatch(id: PresetId): SettingsPatch {
  const s = PRESETS[id].settings;
  return {
    mafiaCount: s.mafiaCount,
    optionalRoles: { ...s.optionalRoles },
    timers: { ...s.timers },
    tieRule: s.tieRule,
    revealRoleOnDeath: s.revealRoleOnDeath,
    showVotes: s.showVotes,
    announceSaves: s.announceSaves,
  };
}

/** Which preset these settings are exactly, or null if the host has customised them. */
export function matchingPreset(settings: GameSettings): PresetId | null {
  for (const id of PRESET_IDS) {
    const p = PRESETS[id].settings;
    const same =
      settings.mafiaCount === p.mafiaCount &&
      settings.tieRule === p.tieRule &&
      settings.revealRoleOnDeath === p.revealRoleOnDeath &&
      settings.showVotes === p.showVotes &&
      settings.announceSaves === p.announceSaves &&
      OPTIONAL_ROLES.every((r) => settings.optionalRoles[r] === p.optionalRoles[r]) &&
      (Object.keys(p.timers) as (keyof typeof p.timers)[]).every((k) => settings.timers[k] === p.timers[k]);
    if (same) return id;
  }
  return null;
}
