import type { ContentMode, NightActionKind } from "@mafia/shared";
import type { IconName } from "../art/icons";

/** Wording that changes with the content mode. The rules never do. */
export const MODE_INFO: Record<ContentMode, { label: string; shortLabel: string; icon: IconName; blurb: string; description: string }> = {
  safe: {
    label: "Safe Mode",
    shortLabel: "Safe",
    icon: "sun",
    blurb: "Family-friendly and cartoony.",
    description: "Family-friendly and cartoony. Players who leave the game are simply sent home.",
  },
  normal: {
    label: "Normal Mode",
    shortLabel: "Normal",
    icon: "moon",
    blurb: "Classic film-noir style.",
    description: "Classic crime drama with darker narration.",
  },
};

export const NIGHT_PROMPT: Record<ContentMode, Record<NightActionKind, string>> = {
  safe: {
    kill: "Choose who to send home",
    protect: "Choose who to protect",
    investigate: "Choose who to investigate",
    guard: "Choose who to guard",
    link: "Choose two players to link",
  },
  normal: {
    kill: "Choose who to eliminate",
    protect: "Choose who to protect",
    investigate: "Choose who to investigate",
    guard: "Choose who to guard",
    link: "Choose two players to link",
  },
};

export const NIGHT_VERB: Record<ContentMode, Record<NightActionKind, string>> = {
  safe: { kill: "Send home", protect: "Protect", investigate: "Investigate", guard: "Guard", link: "Link" },
  normal: { kill: "Eliminate", protect: "Protect", investigate: "Investigate", guard: "Guard", link: "Link" },
};

export const NIGHT_KINDS: NightActionKind[] = ["kill", "protect", "investigate", "guard", "link"];
