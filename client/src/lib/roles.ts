import type { ContentMode, Role, Team } from "@mafia/shared";

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
  tip: string;
}

export const TEAM_LABEL: Record<Team, string> = {
  town: "Town",
  mafia: "Mafia",
  neutral: "Loner",
};

export const ROLE_INFO: Record<Role, RoleInfo> = {
  mafia: {
    team: "mafia",
    optional: false,
    summary: {
      safe: "You're a sneaky Mafia member! You know who your teammates are.",
      normal: "You're Mafia. You and your crew run the shadows of this town.",
    },
    ability: {
      safe: "Each night you and your teammates secretly pick one player to send home. If you disagree, the most votes wins (ties are picked at random).",
      normal: "Each night you and your crew secretly pick one player to eliminate. If you disagree, the most votes wins (ties are picked at random).",
    },
    goal: "Stay hidden until the Mafia are as many as everyone else.",
    tip: "Blend in during the day. Accuse someone, but don't be too loud.",
  },
  doctor: {
    team: "town",
    optional: false,
    summary: {
      safe: "You're the Doctor, the town's helper!",
      normal: "You're the Doctor. You decide who sees the morning.",
    },
    ability: {
      safe: "Each night, protect one player from the Mafia. You can protect yourself, but not the same player two nights in a row.",
      normal: "Each night, protect one player from the Mafia. You can protect yourself, but not the same player two nights in a row.",
    },
    goal: "Help the Town find and vote out every Mafia member.",
    tip: "If nobody dies in the morning, you may have saved someone, but keep it secret!",
  },
  detective: {
    team: "town",
    optional: false,
    summary: {
      safe: "You're the Detective, the town's super sleuth!",
      normal: "You're the Detective. Nothing escapes your attention.",
    },
    ability: {
      safe: "Each night, pick one player to investigate. You'll learn privately whether they are Mafia or not.",
      normal: "Each night, pick one player to investigate. You'll learn privately whether they are Mafia or not.",
    },
    goal: "Help the Town find and vote out every Mafia member.",
    tip: "Share what you know carefully. The Mafia will want you gone.",
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
    goal: "Find and vote out every Mafia member.",
    tip: "Listen for stories that don't add up.",
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
    tip: "Be suspicious, but not so obvious that nobody believes you.",
  },
  bodyguard: {
    team: "town",
    optional: true,
    summary: {
      safe: "You're the Bodyguard, a brave protector!",
      normal: "You're the Bodyguard. You'd take a bullet for a stranger.",
    },
    ability: {
      safe: "Each night, guard one other player. If the Mafia go after them, you take their place and go home instead.",
      normal: "Each night, guard one other player. If the Mafia attack them, you die in their place.",
    },
    goal: "Help the Town find and vote out every Mafia member.",
    tip: "Guard whoever the Mafia would want most, like a loud detective-looking friend.",
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
    goal: "Help the Town find and vote out every Mafia member.",
    tip: "Linking a Mafia member with a Villager makes the Mafia think twice.",
  },
};

export const ROLE_ORDER: Role[] = ["mafia", "doctor", "detective", "villager", "jester", "bodyguard", "cupid"];
