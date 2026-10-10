import { AVATAR_COLORS, nicknameKey, type Avatar } from "@mafia/shared";

/**
 * Bot names: friendly, mode-neutral and short. A bot always gets one that
 * nobody in the room uses (real players included); if a real player later
 * wants a bot's name, the bot takes another.
 */
export const BOT_NAMES = [
  "Pickles", "Waffles", "Noodle", "Biscuit", "Pepper", "Ziggy", "Mango", "Taco", "Bubbles", "Sprocket",
  "Doodle", "Muffin", "Gizmo", "Jellybean", "Nugget", "Pixel", "Turbo", "Wobble", "Zippy", "Marble",
  "Toffee", "Banjo", "Crumpet", "Dumpling", "Fizz", "Gumdrop", "Hopscotch", "Kazoo", "Lollipop", "Meatball",
  "Nacho", "Pudding", "Quokka", "Rascal", "Scooter", "Tinsel", "Waddles", "Yoyo", "Zucchini", "Bramble",
] as const;

/** A free bot name, picked at random; numbered once every name is taken. */
export function freeBotName(taken: readonly string[], random: () => number): string {
  const used = new Set(taken.map(nicknameKey));
  const free = BOT_NAMES.filter((n) => !used.has(nicknameKey(n)));
  if (free.length > 0) return free[Math.floor(random() * free.length)] ?? free[0] ?? "Pickles";
  for (let i = 2; i < 100; i++) {
    for (const base of BOT_NAMES) {
      const name = `${base} ${i}`;
      if (!used.has(nicknameKey(name))) return name;
    }
  }
  return `Bot ${used.size + 1}`;
}

export function randomBotAvatar(random: () => number): Avatar {
  const color = AVATAR_COLORS[Math.floor(random() * AVATAR_COLORS.length)] ?? "teal";
  let seed = "";
  for (let i = 0; i < 8; i++) seed += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)];
  return { color, seed };
}
