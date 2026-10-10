import type { SpeechIntent } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { checkBotLine, type BotLineContext } from "./botChecks.js";

const NAMES = ["Mia", "Sam", "Lee", "Jordan", "Ana"];

function ctx(intent: Partial<SpeechIntent>, mode: "safe" | "normal" = "safe"): BotLineContext {
  return {
    mode,
    gang: "Mafia",
    names: NAMES,
    intent: { id: "s1", bot: "Mia", act: "accuse", tone: "calm", says: "I don't trust Sam.", target: "Sam", ...intent },
  };
}

const reason = (raw: unknown, c: BotLineContext) => {
  const r = checkBotLine(raw, c);
  return r.ok ? "ok" : r.reason;
};

describe("checking a bot message the AI wrote", () => {
  it("accepts a message that says what the intent says", () => {
    expect(checkBotLine("Honestly? Sam has been acting strange all day.", ctx({}))).toEqual({
      ok: true,
      text: "Honestly? Sam has been acting strange all day.",
    });
    // A "Mia:" prefix and wrapping quotes are tidied away.
    expect(checkBotLine('"Mia: Sam is giving me bad vibes."', ctx({}))).toEqual({ ok: true, text: "Sam is giving me bad vibes." });
  });

  it("applies the narrator's rules: the mode's words, length, emoji, links, markup", () => {
    expect(reason("Sam should be eliminated now.", ctx({}))).toBe("banned_word");
    expect(reason("Sam deserves to be shot.", ctx({}))).toBe("banned_word");
    expect(reason("Sam looks like a killer.", ctx({}, "normal"))).toBe("ok");
    expect(reason(`Sam ${"is odd ".repeat(40)}`, ctx({}))).toBe("too_long");
    expect(reason("Sam is sus 😠", ctx({}))).toBe("ok"); // the emoji is stripped, the rest is fine
    expect(reason("😠", ctx({}))).toBe("empty");
    expect(reason("Sam is sus, see www.example.com", ctx({}))).toBe("markup");
    expect(reason("**Sam** is sus", ctx({}))).toBe("markup");
    expect(reason("Sam is a damn liar", ctx({}, "normal"))).toBe("profanity");
    expect(reason(42, ctx({}))).toBe("empty");
  });

  it("must name the intent's players and nobody else", () => {
    expect(reason("Someone here is lying.", ctx({}))).toBe("missing_name");
    expect(reason("Sam and Lee are both odd.", ctx({}))).toBe("other_name");
    // The player it replies to may be named.
    expect(reason("Lee, I agree: Sam is odd.", ctx({ replyTo: { from: "Lee", text: "Sam is sus" } }))).toBe("ok");
    expect(reason("Sam claimed Doctor, but Lee was the Doctor!", ctx({ act: "call_out", about: "Lee", role: "doctor", contradiction: "revealed_role" }))).toBe("ok");
    expect(reason("Sam claimed Doctor, but someone else was!", ctx({ act: "call_out", about: "Lee", role: "doctor", contradiction: "revealed_role" }))).toBe("missing_name");
  });

  it("can't add a role the intent doesn't name, and a claim must say its role", () => {
    expect(reason("As the Detective, I don't trust Sam.", ctx({}))).toBe("role_word");
    expect(reason("Sam is Mafia, I'm sure.", ctx({}))).toBe("ok"); // suspicion, not a role claim
    expect(reason("I'm a simple villager.", ctx({ act: "claim_role", role: "villager", target: undefined }))).toBe("ok");
    expect(reason("Trust me, I'm one of the good ones.", ctx({ act: "claim_role", role: "villager", target: undefined }))).toBe("missing_role");
    expect(reason("I'm the Doctor, actually.", ctx({ act: "claim_role", role: "villager", target: undefined }))).toBe("role_word");
    expect(reason("I checked Sam last night. Sam is Mafia!", ctx({ act: "claim_result", role: "detective", result: "mafia" }))).toBe("ok");
    expect(reason("I checked Sam last night.", ctx({ act: "claim_result", role: "detective", result: "mafia" }))).toBe("missing_result");
    expect(reason("Detective here: Sam is clean.", ctx({ act: "claim_result", role: "detective", result: "innocent" }))).toBe("ok");
  });

  it("can't turn an accusation into a defence", () => {
    expect(reason("It's not Sam, I'm sure.", ctx({}))).toBe("meaning_flipped");
    expect(reason("Sam is innocent.", ctx({ act: "vote_call" }))).toBe("meaning_flipped");
    expect(reason("Sam is innocent.", ctx({ act: "defend_other" }))).toBe("ok");
  });
});
