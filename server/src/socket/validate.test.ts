import { describe, expect, it } from "vitest";
import {
  parseChat,
  parseCreateRoom,
  parseEmpty,
  parseJoinRoom,
  parseNightAction,
  parsePeekRoom,
  parseResume,
  parseSetPassword,
  parseSettingsPatch,
  parseTargetPlayer,
  parseTimeSync,
  parseUpdateProfile,
  parseVote,
} from "./validate.js";

const avatar = { color: "teal", seed: "fox" };

describe("payload validation", () => {
  it("rejects non-objects everywhere they need data", () => {
    for (const parse of [
      parseCreateRoom,
      parsePeekRoom,
      parseJoinRoom,
      parseResume,
      parseUpdateProfile,
      parseTargetPlayer,
      parseSetPassword,
      parseNightAction,
      parseVote,
      parseChat,
      parseTimeSync,
      parseSettingsPatch,
    ]) {
      for (const raw of [undefined, null, "x", 3, [], true]) expect(parse(raw).ok).toBe(false);
    }
  });

  it("accepts empty payloads for data-less events", () => {
    expect(parseEmpty(undefined).ok).toBe(true);
    expect(parseEmpty({}).ok).toBe(true);
    expect(parseEmpty("x").ok).toBe(false);
  });

  it("normalises room codes and rejects impossible ones", () => {
    expect(parseJoinRoom({ roomCode: " abcd ", name: "A", avatar })).toEqual({
      ok: true,
      value: { roomCode: "ABCD", name: "A", avatar },
    });
    expect(parsePeekRoom({ roomCode: "party-22" })).toEqual({ ok: true, value: { roomCode: "PARTY22" } });
    for (const roomCode of ["ABC", "ABCDEFGHI", "AB_D", "x".repeat(40), 1234]) {
      expect(parseJoinRoom({ roomCode, name: "A", avatar }).ok).toBe(false);
      expect(parsePeekRoom({ roomCode }).ok).toBe(false);
    }
  });

  it("requires a valid avatar to create or join, and copies only its fields", () => {
    expect(parseCreateRoom({ name: "A" }).ok).toBe(false);
    expect(parseCreateRoom({ name: "A", avatar: { color: "teal", icon: "fox" } }).ok).toBe(false);
    expect(parseCreateRoom({ name: "A", avatar: { color: "teal", seed: "Upper" } }).ok).toBe(false);
    const parsed = parseCreateRoom({ name: "A", avatar: { ...avatar, extra: "x" }, customCode: "PARTY", password: "pw1" });
    expect(parsed).toEqual({ ok: true, value: { name: "A", avatar, customCode: "PARTY", password: "pw1" } });
    expect(parseJoinRoom({ roomCode: "ABCD", name: "A", avatar, password: 5 }).ok).toBe(false);
  });

  it("checks profile, target and password payloads", () => {
    expect(parseUpdateProfile({}).ok).toBe(false);
    expect(parseUpdateProfile({ name: "New" })).toEqual({ ok: true, value: { name: "New" } });
    expect(parseUpdateProfile({ avatar: { color: "nope", seed: "fox" } }).ok).toBe(false);
    expect(parseTargetPlayer({ playerId: "p1" })).toEqual({ ok: true, value: { playerId: "p1" } });
    expect(parseTargetPlayer({ playerId: 1 }).ok).toBe(false);
    expect(parseSetPassword({ password: null })).toEqual({ ok: true, value: { password: null } });
    expect(parseSetPassword({ password: "secret" })).toEqual({ ok: true, value: { password: "secret" } });
    expect(parseSetPassword({ password: 42 }).ok).toBe(false);
  });

  it("bounds string sizes", () => {
    expect(parseCreateRoom({ name: "x".repeat(65), avatar }).ok).toBe(false);
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
    expect(parseResume({ roomCode: "PARTY22", sessionToken: "a".repeat(32) }).ok).toBe(true);
    expect(parseResume({ roomCode: "ABCD", sessionToken: "a".repeat(32) }).ok).toBe(true);
  });
});
