import { CHAT_REACTIONS, findBannedWord } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { REACTIONS, reactionLabel } from "./reactions";

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️]/u;

describe("quick reactions", () => {
  it("offers exactly the reactions the server accepts, in a fixed order", () => {
    expect(REACTIONS.map((r) => r.id)).toEqual([...CHAT_REACTIONS]);
    expect(CHAT_REACTIONS).toEqual(["sus", "agree", "no_way", "hmm"]);
  });

  it("is a short word for each, with no emoji, clean in Safe Mode", () => {
    expect(REACTIONS.map((r) => r.label)).toEqual(["Sus", "Agree", "No way", "Hmm"]);
    for (const r of REACTIONS) {
      expect(r.label).not.toMatch(EMOJI);
      expect(findBannedWord(r.label, "safe")).toBeNull();
      expect(reactionLabel(r.id)).toBe(r.label);
    }
  });

  it("reads an old reaction id as a plain word", () => {
    expect(reactionLabel("laughing")).toBe("Reacted");
  });
});
