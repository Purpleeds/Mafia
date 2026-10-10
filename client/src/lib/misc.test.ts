import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";
import { HINTS, hintFor } from "./hints";
import { gameKey, parseNotes } from "./notes";
import { noticeText } from "./notices";
import { indexForKey, keyForIndex } from "./shortcuts";
import { PHASES, findBannedWord, type RoomNoticeKind } from "@mafia/shared";

const EMOJI = /[\p{Extended_Pictographic}️]/u;

describe("keyboard shortcuts", () => {
  it("numbers the first ten players 1–9 then 0", () => {
    expect([0, 1, 8, 9, 10, -1].map(keyForIndex)).toEqual(["1", "2", "9", "0", null, null]);
    expect(["1", "9", "0", "a", "Enter"].map(indexForKey)).toEqual([0, 8, 9, null, null]);
  });
});

describe("private notes", () => {
  it("belong to one game and drop anything broken", () => {
    expect(gameKey("ABCD", 2)).toBe("ABCD#2");
    expect(
      parseNotes(JSON.stringify({ game: "ABCD#2", notes: { p1: { tag: "suspect", text: "quiet" }, p2: { tag: "evil", text: "" }, p3: "x" } })),
    ).toEqual({ game: "ABCD#2", notes: { p1: { tag: "suspect", text: "quiet" } } });
    expect(parseNotes("nope")).toBeNull();
  });
});

describe("messages about people in the room", () => {
  it("says what happened in plain words, with no emoji", () => {
    const kinds: RoomNoticeKind[] = ["joined", "left", "kicked", "dropped", "disconnected", "reconnected", "host_changed", "avatar_approved", "avatar_rejected", "avatar_removed", "bot_takeover", "bot_released"];
    for (const kind of kinds) {
      const text = noticeText({ kind, playerId: "p2", name: "Ana" }, "p1");
      expect(text, kind).toBeTruthy();
      expect(text).not.toMatch(EMOJI);
    }
    expect(noticeText({ kind: "host_changed", playerId: "p1", name: "Ana" }, "p1")).toBe("You're now the host.");
    expect(noticeText({ kind: "disconnected", playerId: "p2", name: "Ana" }, "p1")).toBe("Ana lost their connection.");
    expect(noticeText({ kind: "bot_takeover", playerId: "p2", name: "Sam" }, "p1")).toBe("A bot is now playing for Sam.");
    expect(noticeText({ kind: "bot_released", playerId: "p2", name: "Sam" }, "p1")).toBe("Sam is back and playing again.");
    expect(noticeText({ kind: "joined", playerId: "p3", name: "Pickles", isBot: true }, "p1")).toBeNull();
    expect(noticeText({ kind: "left", playerId: "p3", name: "Pickles", isBot: true }, "p1")).toBeNull();
  });
});

describe("tips", () => {
  it("has one for every phase, the same for every role, clean in Safe Mode", () => {
    for (const phase of PHASES) {
      const hint = HINTS[hintFor(phase)];
      expect(hint.text.length).toBeGreaterThan(20);
      expect(findBannedWord(`${hint.title} ${hint.text}`, "safe"), phase).toBeNull();
      expect(`${hint.title} ${hint.text}`).not.toMatch(/\b(detective|doctor|bodyguard|cupid|jester|mafia)\b/i);
    }
  });
});

describe("friendly errors", () => {
  it("never shows a technical server message", () => {
    expect(friendlyError({ code: "BAD_REQUEST", message: "targetId must be a player id." })).toBe("Something about that didn't work. Try again.");
    expect(friendlyError({ code: "BAD_REQUEST", message: "Messages must be 1–300 characters." })).toBe("Messages must be 1–300 characters.");
    expect(friendlyError({ code: "INVALID_SETTINGS", message: "mafiaCount must be a whole number" })).toBe("Those settings aren't allowed.");
    expect(friendlyError({ code: "CHAT_LINK", message: "x" })).toBe("Links can't be shared in chat.");
    expect(friendlyError({ code: "SERVER_ERROR", message: "TypeError: undefined is not an object" })).toMatch(/Something went wrong/);
  });
});
