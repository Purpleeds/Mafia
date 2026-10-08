import { TIMER_LIMITS, defaultMafiaCount, MIN_PLAYERS, type OptionalRole, type TimerSettings } from "@mafia/shared";

export const TIMER_KEYS = [
  "roleRevealSeconds",
  "nightSeconds",
  "nightResultsSeconds",
  "discussionSeconds",
  "votingSeconds",
  "voteResultsSeconds",
] as const satisfies readonly (keyof TimerSettings)[];

export const TIMER_LABEL: Record<keyof TimerSettings, string> = {
  roleRevealSeconds: "Role reveal",
  nightSeconds: "Night",
  nightResultsSeconds: "Morning news",
  discussionSeconds: "Discussion",
  votingSeconds: "Voting",
  voteResultsSeconds: "Vote results",
};

export const OPTIONAL_ROLE_INFO: Record<OptionalRole, { label: string; description: string }> = {
  jester: { label: "Jester", description: "Wins by getting voted out." },
  bodyguard: { label: "Bodyguard", description: "Guards someone each night." },
  cupid: { label: "Cupid", description: "Links two lovers on the first night." },
};

/** Choices for a timer select: nice steps between the limits, always including the current value. */
export function timerOptions(key: keyof TimerSettings, current: number): number[] {
  const { min, max } = TIMER_LIMITS[key];
  const step = max > 300 ? 15 : 5;
  const values = new Set<number>([min, max, current]);
  for (let v = Math.ceil(min / step) * step; v < max; v += step) values.add(v);
  return [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

export function mafiaCountLabel(setting: number | "auto", playerCount: number): string {
  if (setting !== "auto") return String(setting);
  // Below the minimum the count isn't meaningful yet; describe the rule instead.
  if (playerCount < MIN_PLAYERS) return "Auto (about 1 per 4 players)";
  const mafia = defaultMafiaCount(playerCount);
  return `Auto (${mafia} with ${playerCount} players)`;
}
