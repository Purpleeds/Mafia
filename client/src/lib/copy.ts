import type { ContentMode, NightActionKind, Role, VoteOutcome, GameView } from "@mafia/shared";
import { ROLE_LABEL } from "./labels";

/** Wording that changes with the content mode. The rules never do. */
export const MODE_INFO: Record<ContentMode, { label: string; emoji: string; blurb: string }> = {
  safe: { label: "Safe Mode", emoji: "🎈", blurb: "Family-friendly and cartoony." },
  normal: { label: "Normal Mode", emoji: "🕵️", blurb: "Classic crime-drama Mafia." },
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

export const SLEEP_LINES = ["Sleeping…", "Shhh… the town is asleep", "Everyone is dreaming…"];

type Names = (id: string) => string;

export function nameLookup(view: GameView): Names {
  return (id) => view.players.find((p) => p.id === id)?.name ?? view.spectators.find((s) => s.id === id)?.name ?? "Someone";
}

function roleSentence(role: Role | null): string {
  return role ? ` They were the ${ROLE_LABEL[role]}.` : "";
}

/** The narrator's morning announcement. A later step can swap this for AI-written text. */
export function nightNarration(mode: ContentMode, view: GameView): string {
  const report = view.nightReport;
  const name = nameLookup(view);
  const safe = mode === "safe";
  if (!report || report.deaths.length === 0) {
    return safe
      ? "The sun peeks over the rooftops. Everyone made it through the night safe and sound!"
      : "Dawn breaks over the city. Everyone survived the night. For now.";
  }
  const parts = [safe ? "The sun rises… but something is not right." : "Dawn breaks. The town wakes to bad news."];
  for (const d of report.deaths) {
    if (d.cause === "heartbreak") {
      parts.push(
        safe
          ? `${name(d.playerId)} was so sad about their friend that they went home too.${roleSentence(d.role)}`
          : `${name(d.playerId)} could not live without their lover, and died of a broken heart.${roleSentence(d.role)}`,
      );
    } else {
      parts.push(
        safe
          ? `${name(d.playerId)} was sent home by the Mafia!${roleSentence(d.role)}`
          : `${name(d.playerId)} was killed in the night.${roleSentence(d.role)}`,
      );
    }
  }
  return parts.join(" ");
}

export function voteNarration(mode: ContentMode, view: GameView): string {
  const report = view.voteReport;
  const name = nameLookup(view);
  const safe = mode === "safe";
  if (!report) return "";
  const outcome: VoteOutcome = report.outcome;
  if (outcome === "eliminated") {
    const parts: string[] = [];
    for (const d of report.deaths) {
      if (d.cause === "vote") {
        parts.push(
          safe
            ? `The votes are in! The town sends ${name(d.playerId)} home.${roleSentence(d.role)}`
            : `The votes are in. The town has condemned ${name(d.playerId)}.${roleSentence(d.role)}`,
        );
      } else {
        parts.push(
          safe
            ? `${name(d.playerId)} was so sad about their friend that they went home too.${roleSentence(d.role)}`
            : `${name(d.playerId)} could not live without their lover, and died of a broken heart.${roleSentence(d.role)}`,
        );
      }
    }
    return parts.join(" ");
  }
  if (outcome === "skipped") {
    return safe ? "The town decided to skip today. Nobody goes home!" : "The town chose to spare everyone today.";
  }
  if (outcome === "tie") {
    return safe ? "It's a tie! Nobody goes home today." : "The vote is tied. Nobody is eliminated.";
  }
  return "Nobody cast a vote today.";
}
