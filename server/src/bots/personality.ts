/**
 * Every bot gets its own personality when the host adds it: five traits from
 * 0 to 1 and a speaking style. Nothing here is shown in the game. The style is
 * the only part the host's AI ever sees, and it doesn't depend on the bot's
 * role (it is picked in the lobby, before anyone has a role).
 */

export interface BotTraits {
  /** How often it speaks. */
  talkativeness: number;
  /** How easily it believes claims and accusations. */
  gullibility: number;
  /** How readily it accuses others. */
  aggression: number;
  /** How hard it is to change its mind once it suspects someone. */
  stubbornness: number;
  /** As the Mafia: how convincing and consistent its lies are. */
  deception: number;
}

export const SPEAKING_STYLES = {
  nervous: "nervous and polite; hedges and apologises a lot",
  blunt: "blunt and confident; short, direct sentences",
  jokey: "jokey and playful; light teasing",
  quiet: "quiet; very short messages, a few words",
  dramatic: "dramatic and theatrical; big reactions",
  logical: "calm and logical; likes to point at evidence",
  chatty: "friendly and chatty; talks to everyone",
  suspicious: "suspicious of everyone; a little paranoid",
  laidback: "laid-back and relaxed; never in a hurry",
  earnest: "earnest and eager to help the town",
  grumpy: "grumpy but fair; impatient",
  noir: "talks like an old detective film; dry and moody",
} as const;

export type SpeakingStyle = keyof typeof SPEAKING_STYLES;

export const STYLE_IDS = Object.keys(SPEAKING_STYLES) as SpeakingStyle[];

export interface BotPersonality extends BotTraits {
  style: SpeakingStyle;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** How each style leans the traits, so a "quiet" bot talks less and a "blunt" one accuses more. */
const STYLE_LEAN: Record<SpeakingStyle, Partial<BotTraits>> = {
  nervous: { aggression: -0.25, gullibility: 0.2, stubbornness: -0.15 },
  blunt: { aggression: 0.25, stubbornness: 0.15 },
  jokey: { talkativeness: 0.15 },
  quiet: { talkativeness: -0.35 },
  dramatic: { talkativeness: 0.2, aggression: 0.15, gullibility: 0.1 },
  logical: { gullibility: -0.25, stubbornness: 0.15 },
  chatty: { talkativeness: 0.3 },
  suspicious: { aggression: 0.2, gullibility: -0.2 },
  laidback: { aggression: -0.2, talkativeness: -0.1 },
  earnest: { gullibility: 0.15 },
  grumpy: { aggression: 0.15, stubbornness: 0.2 },
  noir: { stubbornness: 0.1 },
};

/**
 * A random personality. The style is one the room's other bots don't have yet
 * (while there are unused ones), so bots in a room sound different.
 */
export function randomPersonality(random: () => number, takenStyles: readonly string[] = []): BotPersonality {
  const free = STYLE_IDS.filter((s) => !takenStyles.includes(s));
  const pool = free.length > 0 ? free : STYLE_IDS;
  const style = pool[Math.floor(random() * pool.length)] ?? "chatty";
  const lean = STYLE_LEAN[style];
  const trait = (key: keyof BotTraits) => clamp01(0.08 + random() * 0.84 + (lean[key] ?? 0));
  return {
    talkativeness: trait("talkativeness"),
    gullibility: trait("gullibility"),
    aggression: trait("aggression"),
    stubbornness: trait("stubbornness"),
    deception: trait("deception"),
    style,
  };
}

/** A small, stable number from text, for things that must not change between restarts. */
export function hashUnit(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/** A personality worked out from a seed (a bot saved by an older version gets one this way). */
export function personalityFromSeed(seed: string): BotPersonality {
  let n = 0;
  return randomPersonality(() => hashUnit(`${seed}:${n++}`));
}

/**
 * For a bot standing in for a player who is away: it listens and votes, but
 * never speaks for them, and its judgement is middle of the road.
 */
export function standInPersonality(): BotPersonality {
  return { talkativeness: 0, gullibility: 0.4, aggression: 0.4, stubbornness: 0.5, deception: 0.5, style: "quiet" };
}

/** What the host's AI is told about how a bot talks. */
export function styleDescription(style: string): string {
  return (SPEAKING_STYLES as Record<string, string>)[style] ?? SPEAKING_STYLES.chatty;
}

export function isSpeakingStyle(value: unknown): value is SpeakingStyle {
  return typeof value === "string" && (STYLE_IDS as string[]).includes(value);
}

/** A stored personality as it should be, whatever was saved (unknown fields dropped, numbers clamped). */
export function cleanPersonality(raw: unknown, seed: string): BotPersonality {
  if (!raw || typeof raw !== "object") return personalityFromSeed(seed);
  const r = raw as Record<string, unknown>;
  const fallback = personalityFromSeed(seed);
  const num = (key: keyof BotTraits) => (typeof r[key] === "number" && Number.isFinite(r[key]) ? clamp01(r[key] as number) : fallback[key]);
  return {
    talkativeness: num("talkativeness"),
    gullibility: num("gullibility"),
    aggression: num("aggression"),
    stubbornness: num("stubbornness"),
    deception: num("deception"),
    style: isSpeakingStyle(r.style) ? r.style : fallback.style,
  };
}
