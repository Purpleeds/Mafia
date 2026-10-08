import { gangName, type NarrationFacts, type NarrationHow } from "@mafia/shared";
import type { DeathRecord, GameState } from "../game/types.js";

const HOW: Record<DeathRecord["cause"], NarrationHow> = { mafia: "night", vote: "vote", heartbreak: "heartbreak" };

/**
 * The facts the narrator may know about the announcement that is waiting, or
 * null if none is. This is the only thing that ever leaves the server for the
 * AI, so it is built from public information alone: the names of whoever left
 * the game, whether the Doctor's save was announced, the round, the mode and
 * what the Mafia are called. Never an id, a role, or who did what at night.
 */
export function narrationFacts(state: GameState): NarrationFacts | null {
  const narration = state.narration;
  if (!narration) return null;

  const eliminated = (deaths: DeathRecord[]): NarrationFacts["eliminated"] =>
    deaths.flatMap((d) => {
      const name = state.players.find((p) => p.id === d.playerId)?.name;
      return name === undefined ? [] : [{ name, how: HOW[d.cause] }];
    });

  const base = {
    kind: narration.kind,
    mode: state.settings.contentMode,
    round: narration.round,
    gang: gangName(state.settings),
  } as const;

  if (narration.kind === "night") {
    const report = state.nightReport;
    return {
      ...base,
      eliminated: report ? eliminated(report.deaths) : [],
      // A save stays secret unless the host announces saves (the same rule the players' view follows).
      saved: report !== null && report.saved && state.settings.announceSaves,
      voteOutcome: null,
    };
  }

  const report = state.voteReport;
  return {
    ...base,
    eliminated: report ? eliminated(report.deaths) : [],
    saved: false,
    voteOutcome: report?.outcome ?? "nobody",
  };
}
