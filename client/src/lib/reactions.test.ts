import { CHAT_REACTIONS, findBannedWord } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { REACTIONS, reactionInfo } from "./reactions";

describe("quick reactions", () => {
  it("offers exactly the reactions the server accepts, in a fixed order", () => {
    expect(REACTIONS.map((r) => r.id)).toEqual([...CHAT_REACTIONS]);
    expect(CHAT_REACTIONS).toEqual(["thinking", "suspicious", "laughing", "shocked"]);
  });

  it("has a word and an icon for each (never colour or a picture alone)", () => {
    for (const r of REACTIONS) {
      expect(r.label.length).toBeGreaterThan(3);
      expect(r.icon).toBe(r.id);
      expect(findBannedWord(r.label, "safe")).toBeNull();
      expect(reactionInfo(r.id)).toBe(r);
    }
  });
});
