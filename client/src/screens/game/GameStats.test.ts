import { defaultSettings, findBannedWord, type GameStatsView, type GameView } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { joinNames, statLines } from "./GameStats";

const players = ["Ana", "Ben", "Cleo", "Dev"].map((name, i) => ({ id: `p${i + 1}`, name })) as unknown as GameView["players"];
const stats: GameStatsView = {
  survivedLongest: { playerIds: ["p1", "p2"] },
  lastToLeave: { playerIds: ["p3"], round: 2, part: "night" },
  bestDetective: { playerIds: ["p2"], entries: [{ playerId: "p2", mafiaVotes: 2, mafiaFound: 1 }] },
  mostSuspiciousVoter: { playerIds: ["p4"], innocentVotes: 2, totalVotes: 3 },
  votesSecret: false,
};
const view = (contentMode: "safe" | "normal", sneakyGang = false) => ({ players, settings: { ...defaultSettings(), contentMode, sneakyGang } });

describe("end-of-game highlights", () => {
  it("join names the way people say them", () => {
    expect(joinNames(["Ana"])).toBe("Ana");
    expect(joinNames(["Ana", "Ben"])).toBe("Ana and Ben");
    expect(joinNames(["Ana", "Ben", "Cleo"])).toBe("Ana, Ben and Cleo");
  });

  it("read naturally", () => {
    const text = statLines(stats, view("normal")).map((l) => `${l.title}: ${l.text}`);
    expect(text).toEqual([
      "Survived longest: Ana and Ben were still in the game at the very end.",
      "Held on the longest: Of the players who were eliminated, Cleo lasted longest: until night 2.",
      "Best detective: Ben: 2 votes and 1 investigation pointed straight at the Mafia.",
      "Most suspicious voter: Dev voted against innocent players 2 of 3 times.",
    ]);
  });

  it("speak Safe Mode, with the Mafia's chosen name", () => {
    const lines = statLines(stats, view("safe", true));
    const all = lines.map((l) => `${l.title} ${l.text}`).join(" ");
    expect(findBannedWord(all, "safe")).toBeNull();
    expect(all).toContain("went home");
    expect(all).toContain("the Sneaky Gang");
  });

  it("give tied detectives their own counts, and only say 'each' when they really match", () => {
    const mixed = statLines(
      { ...stats, bestDetective: { playerIds: ["p2", "p3"], entries: [{ playerId: "p2", mafiaVotes: 1, mafiaFound: 1 }, { playerId: "p3", mafiaVotes: 2, mafiaFound: 0 }] } },
      view("normal"),
    ).find((l) => l.key === "detective");
    expect(mixed?.text).toBe("Ben (1 vote and 1 investigation) and Cleo (2 votes) pointed straight at the Mafia.");
    const same = statLines(
      { ...stats, bestDetective: { playerIds: ["p2", "p3"], entries: [{ playerId: "p2", mafiaVotes: 2, mafiaFound: 0 }, { playerId: "p3", mafiaVotes: 2, mafiaFound: 0 }] } },
      view("normal"),
    ).find((l) => l.key === "detective");
    expect(same?.text).toBe("Ben and Cleo: 2 votes each pointed straight at the Mafia.");
  });

  it("say votes were secret instead of judging anyone's votes", () => {
    const lines = statLines({ ...stats, mostSuspiciousVoter: null, votesSecret: true }, view("safe"));
    expect(lines.at(-1)?.text).toBe("Votes were secret this game, so nobody's votes are judged.");
    expect(lines.at(-1)?.playerIds).toEqual([]);
  });
});
