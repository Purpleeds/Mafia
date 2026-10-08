import type { ContentMode, Role, Team } from "@mafia/shared";

/**
 * What each role is and does. The wording changes with the content mode, and the
 * placeholders {gang}, {theGang} and {TheGang} become "Mafia" / "the Mafia" or,
 * if the host chose it in Safe Mode, "Sneaky Gang" (see fill() in wording.ts).
 */
export interface RoleInfo {
  team: Team;
  /** Needs switching on by the host. */
  optional: boolean;
  /** What you are, in the tone of the content mode. */
  summary: Record<ContentMode, string>;
  /** What you can do. */
  ability: Record<ContentMode, string>;
  /** How you win. */
  goal: string;
  tip: Record<ContentMode, string>;
}

export const ROLE_INFO: Record<Role, RoleInfo> = {
  mafia: {
    team: "mafia",
    optional: false,
    summary: {
      safe: "You're a secret member of {theGang}! You know who your teammates are.",
      normal: "You're {gang}. You and your crew run the shadows of this town.",
    },
    ability: {
      safe: "Each night you and your teammates secretly pick one player to send home. If you disagree, the most votes wins (ties are picked at random).",
      normal: "Each night you and your crew secretly pick one player to eliminate. If you disagree, the most votes wins (ties are picked at random).",
    },
    goal: "Stay hidden until {theGang} are as many as everyone else.",
    tip: {
      safe: "Blend in during the day. Point at someone, but don't be too loud.",
      normal: "Blend in during the day. Accuse someone, but don't be too loud.",
    },
  },
  doctor: {
    team: "town",
    optional: false,
    summary: {
      safe: "You're the Doctor, the town's helper!",
      normal: "You're the Doctor. You decide who sees the morning.",
    },
    ability: {
      safe: "Each night, protect one player from {theGang}. You can protect yourself, but not the same player two nights in a row.",
      normal: "Each night, protect one player from {theGang}. You can protect yourself, but not the same player two nights in a row.",
    },
    goal: "Help the Town find and vote out every {gang} member.",
    tip: {
      safe: "If nobody goes home in the morning, you may have saved someone, but keep it secret!",
      normal: "If nobody dies in the morning, you may have saved someone, but keep it secret!",
    },
  },
  detective: {
    team: "town",
    optional: false,
    summary: {
      safe: "You're the Detective, the town's super sleuth!",
      normal: "You're the Detective. Nothing escapes your attention.",
    },
    ability: {
      safe: "Each night, pick one player to investigate. You'll learn privately whether they are in {theGang} or not.",
      normal: "Each night, pick one player to investigate. You'll learn privately whether they are {gang} or not.",
    },
    goal: "Help the Town find and vote out every {gang} member.",
    tip: {
      safe: "Share what you know carefully. {TheGang} would love to send you home.",
      normal: "Share what you know carefully. {TheGang} will want you gone.",
    },
  },
  villager: {
    team: "town",
    optional: false,
    summary: {
      safe: "You're a Villager, a friendly face in town!",
      normal: "You're a Villager, an ordinary citizen of a dangerous town.",
    },
    ability: {
      safe: "You have no night power. Your voice and your vote are your strength.",
      normal: "You have no night power. Your voice and your vote are your weapons.",
    },
    goal: "Find and vote out every {gang} member.",
    tip: {
      safe: "Listen for stories that don't add up.",
      normal: "Listen for stories that don't add up.",
    },
  },
  jester: {
    team: "neutral",
    optional: true,
    summary: {
      safe: "You're the Jester, the town's silliest troublemaker!",
      normal: "You're the Jester. You want the town to hang you.",
    },
    ability: {
      safe: "You have no night power. Act suspicious and try to get everyone to vote for you!",
      normal: "You have no night power. Act suspicious and try to get the town to vote you out.",
    },
    goal: "Get voted out during the day. If you are, you win alone and the game ends.",
    tip: {
      safe: "Be silly and suspicious, but not so obvious that nobody believes you.",
      normal: "Be suspicious, but not so obvious that nobody believes you.",
    },
  },
  bodyguard: {
    team: "town",
    optional: true,
    summary: {
      safe: "You're the Bodyguard, a brave protector!",
      normal: "You're the Bodyguard. You'd take a bullet for a stranger.",
    },
    ability: {
      safe: "Each night, guard one other player. If {theGang} go after them, you take their place and go home instead.",
      normal: "Each night, guard one other player. If {theGang} attack them, you die in their place.",
    },
    goal: "Help the Town find and vote out every {gang} member.",
    tip: {
      safe: "Guard whoever {theGang} would want most, like a loud, clever-looking friend.",
      normal: "Guard whoever {theGang} would want most, like a loud, clever-looking friend.",
    },
  },
  cupid: {
    team: "town",
    optional: true,
    summary: {
      safe: "You're Cupid, the matchmaker!",
      normal: "You're Cupid. You tie two fates together.",
    },
    ability: {
      safe: "On the first night, link two players (you can pick yourself) as lovers. If one of them goes home, the other follows.",
      normal: "On the first night, link two players (you can pick yourself) as lovers. If one of them dies, the other dies too.",
    },
    goal: "Help the Town find and vote out every {gang} member.",
    tip: {
      safe: "Linking a {gang} member with a Villager makes {theGang} think twice.",
      normal: "Linking a {gang} member with a Villager makes {theGang} think twice.",
    },
  },
};

export const ROLE_ORDER: Role[] = ["mafia", "doctor", "detective", "villager", "jester", "bodyguard", "cupid"];
