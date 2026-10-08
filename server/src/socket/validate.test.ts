import { describe, expect, it } from "vitest";
import {
  parseChat,
  parseCreateRoom,
  parseEmpty,
  parseJoinRoom,
  parseNightAction,
  parseResume,
  parseSettingsPatch,
  parseTimeSync,
  parseVote,
} from "./validate.js";

describe("payload validation", () => {
  it("rejects non-objects everywhere they need data", () => {
    for (const parse of [parseCreateRoom, parseJoinRoom, parseResume, parseNightAction, parseVote, parseChat, parseTimeSync, parseSettingsPatch]) {
      for (const raw of [undefined, null, "x", 3, [], true]) expect(parse(raw).ok).toBe(false);
    }
  });

  it("accepts empty payloads for data-less events", () => {
    expect(parseEmpty(undefined).ok).toBe(true);
    expect(parseEmpty({}).ok).toBe(true);
    expect(parseEmpty("x").ok).toBe(false);
  });

  it("normalises room codes and rejects impossible ones", () => {
    expect(parseJoinRoom({ roomCode: " abcd ", name: "A" })).toEqual({ ok: true, value: { roomCode: "ABCD", name: "A" } });
    for (const roomCode of ["ABC", "ABCDE", "AB1D", "ABIO", 1234]) {
      expect(parseJoinRoom({ roomCode, name: "A" }).ok).toBe(false);
    }
  });

  it("bounds string sizes", () => {
    expect(parseCreateRoom({ name: "x".repeat(65) }).ok).toBe(false);
    expect(parseVote({ targetId: "x".repeat(65) }).ok).toBe(false);
    expect(parseChat({ channel: "public", text: "x".repeat(2001) }).ok).toBe(false);
    expect(parseSettingsPatch({ timers: { nightSeconds: "x".repeat(3000) } }).ok).toBe(false);
  });

  it("only passes through known fields", () => {
    const parsed = parseVote({ targetId: "p1", playerId: "someone-else", extra: 1 });
    expect(parsed).toEqual({ ok: true, value: { targetId: "p1" } });
    const night = parseNightAction({ targetId: "a", secondTargetId: "b", playerId: "x" });
    expect(night).toEqual({ ok: true, value: { targetId: "a", secondTargetId: "b" } });
  });

  it("checks types of each field", () => {
    expect(parseNightAction({ targetId: 3 }).ok).toBe(false);
    expect(parseNightAction({ targetId: "a", secondTargetId: 3 }).ok).toBe(false);
    expect(parseChat({ channel: "secret", text: "hi" }).ok).toBe(false);
    expect(parseChat({ channel: "mafia", text: "hi" }).ok).toBe(true);
    expect(parseTimeSync({ clientSentAt: Number.NaN }).ok).toBe(false);
    expect(parseResume({ roomCode: "ABCD", sessionToken: "short" }).ok).toBe(false);
    expect(parseResume({ roomCode: "ABCD", sessionToken: "a".repeat(32) }).ok).toBe(true);
  });
});
