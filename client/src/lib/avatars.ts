import { AVATAR_COLORS, isAvatarSeed, type Avatar, type AvatarColor } from "@mafia/shared";
import { AVATAR_COLOR_HEX, describeAvatar } from "../art/avatar";
import { randomSeed } from "../art/rng";

export { AVATAR_COLOR_HEX };

export function colorLabel(color: AvatarColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

export function avatarLabel(avatar: Avatar): string {
  return describeAvatar(avatar);
}

export function randomAvatar(): Avatar {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return { color: AVATAR_COLORS[(bytes[0] ?? 0) % AVATAR_COLORS.length] ?? "blue", seed: randomSeed() };
}

/** Accepts today's avatars and the older colour + emoji-icon ones (the icon name becomes the seed). */
export function migrateAvatar(value: unknown): Avatar | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const color = v.color;
  if (typeof color !== "string" || !(AVATAR_COLORS as readonly string[]).includes(color)) return null;
  const seed = isAvatarSeed(v.seed) ? v.seed : isAvatarSeed(v.icon) ? v.icon : null;
  return seed ? { color: color as AvatarColor, seed } : null;
}
