import { AVATAR_COLORS, AVATAR_ICONS, type Avatar, type AvatarColor, type AvatarIcon } from "@mafia/shared";

export const AVATAR_COLOR_HEX: Record<AvatarColor, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  lime: "#84cc16",
  green: "#22c55e",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  pink: "#ec4899",
  slate: "#64748b",
};

export const AVATAR_ICON_EMOJI: Record<AvatarIcon, string> = {
  fox: "🦊",
  cat: "🐱",
  owl: "🦉",
  frog: "🐸",
  bear: "🐻",
  rabbit: "🐰",
  panda: "🐼",
  penguin: "🐧",
  octopus: "🐙",
  unicorn: "🦄",
  dragon: "🐲",
  robot: "🤖",
  lion: "🦁",
  alien: "👽",
  cactus: "🌵",
  mushroom: "🍄",
};

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function colorLabel(color: AvatarColor): string {
  return capitalize(color);
}

export function iconLabel(icon: AvatarIcon): string {
  return capitalize(icon);
}

export function avatarLabel(avatar: Avatar): string {
  return `${colorLabel(avatar.color)} ${avatar.icon}`;
}

function pick<T>(items: readonly T[], fallback: T): T {
  return items[Math.floor(Math.random() * items.length)] ?? fallback;
}

export function randomAvatar(): Avatar {
  return { color: pick(AVATAR_COLORS, "blue"), icon: pick(AVATAR_ICONS, "fox") };
}
