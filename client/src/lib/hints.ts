import { useSyncExternalStore } from "react";
import type { Phase } from "@mafia/shared";

/**
 * First-game tips: one short explanation per phase, shown until the player
 * taps "Got it" (or turns tips off). The same tip for every role, so a tip
 * never hints at anyone's role.
 */
export type HintId = "lobby" | "role" | "night" | "morning" | "day" | "voting" | "results" | "end";

export const HINTS: Record<HintId, { title: string; text: string }> = {
  lobby: {
    title: "Getting started",
    text: "Everyone plays on their own phone. Tap Ready when you're set; the host starts the game.",
  },
  role: {
    title: "Your secret role",
    text: "Tap the card to see your role, read it, then tap it again to hide it. Don't let anyone peek. Tap I'm ready when you're done.",
  },
  night: {
    title: "Night",
    text: "Everyone sees the same night screen, so nobody can tell who has a power. If you have one, pick a player and lock it in. If you don't, pick anyone: it does nothing.",
  },
  morning: {
    title: "Morning news",
    text: "The narrator tells everyone what happened in the night. Everyone also has a private note to tap: it only says something if your role learned something.",
  },
  day: {
    title: "Day discussion",
    text: "Talk it over, in the chat or out loud. When you've said your piece, tap Done talking: voting starts early once everyone has.",
  },
  voting: {
    title: "Voting",
    text: "Tap a player, then confirm (on a keyboard: their number, then Enter). You can change your vote until the timer ends. Not voting counts as Skip.",
  },
  results: {
    title: "The result",
    text: "The votes are counted and the town's choice is announced. Then night falls again.",
  },
  end: {
    title: "Game over",
    text: "Everyone's roles are revealed, with the highlights of the game. The host can start another one.",
  },
};

export function hintFor(phase: Phase): HintId {
  switch (phase) {
    case "LOBBY":
      return "lobby";
    case "ROLE_REVEAL":
      return "role";
    case "NIGHT":
      return "night";
    case "NIGHT_RESULTS":
      return "morning";
    case "DAY_DISCUSSION":
      return "day";
    case "VOTING":
      return "voting";
    case "VOTE_RESULTS":
      return "results";
    case "GAME_OVER":
      return "end";
  }
}

const SEEN_KEY = "mafia.hintsSeen";

function readSeen(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

let seen: string[] = typeof window === "undefined" ? [] : readSeen();
const listeners = new Set<() => void>();

export function markHintSeen(id: HintId): void {
  if (seen.includes(id)) return;
  seen = [...seen, id];
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // storage blocked: the tip stays hidden for this visit
  }
  for (const listener of listeners) listener();
}

/** Shows every tip again (from the display settings). */
export function resetHints(): void {
  seen = [];
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // ignore
  }
  for (const listener of listeners) listener();
}

export function useHintsSeen(): readonly string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => seen,
    () => seen,
  );
}
