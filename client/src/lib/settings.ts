import {
  TIMER_LIMITS,
  defaultMafiaCount,
  MIN_PLAYERS,
  type AvatarPolicy,
  type ChatFilter,
  type OptionalRole,
  type TimerSettings,
} from "@mafia/shared";

export const CHAT_FILTER_INFO: Record<ChatFilter, { label: string; description: string }> = {
  strict: { label: "Strict", description: "Hides swearing, slurs and rude words, and milder ones like \"damn\" or \"idiot\"." },
  standard: { label: "Standard", description: "Hides swearing, slurs and sexual words. Milder words get through." },
  uncensored: {
    label: "Uncensored",
    description: "Nothing is hidden. Everyone sees a notice, and each player can still hide strong language on their own screen.",
  },
};

export const AVATAR_POLICY_INFO: Record<AvatarPolicy, { label: string; description: string }> = {
  off: { label: "Off", description: "Everyone uses a drawn avatar." },
  on: { label: "On", description: "Players can use their own picture. It shows to everyone straight away." },
  approval: { label: "Host approval", description: "Players can use their own picture once you've approved it." },
};

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
