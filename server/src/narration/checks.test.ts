import { NARRATION_MAX_LENGTH, NARRATOR_SYSTEM_PROMPT, hasEmoji, type ContentMode } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { checkNarration, tidyNarration, type NarrationCheckContext } from "./checks.js";

const ctx = (mode: ContentMode, patch: Partial<NarrationCheckContext> = {}): NarrationCheckContext => ({
  mode,
  eliminatedNames: ["Ana"],
  otherNames: ["Ben", "Cleo", "Dev"],
  mayMentionDoctor: false,
  ...patch,
});

const reason = (text: unknown, c: NarrationCheckContext): string => {
  const result = checkNarration(text, c);
  return result.ok ? "ok" : result.reason;
};

describe("narration checks: what is accepted", () => {
  it("accepts a good Safe Mode line that names the player", () => {
    const result = checkNarration("Ana was whisked away in the night by the Sneaky Gang. Who will be next?", ctx("safe"));
    expect(result).toEqual({ ok: true, text: "Ana was whisked away in the night by the Sneaky Gang. Who will be next?" });
  });

  it("accepts a good Normal Mode line, noir violence included", () => {
    const line = "A single shot rang out across the town. By morning, Ana was gone, found at the docks, poisoned at dinner.";
    expect(reason(line, ctx("normal"))).toBe("ok");
  });

  it("accepts a quiet night with nobody to name", () => {
    const quiet = ctx("safe", { eliminatedNames: [] });
    expect(reason("The sun peeks over the rooftops. Everyone made it through the night!", quiet)).toBe("ok");
  });

  it("accepts the Doctor only when a save was announced", () => {
    const line = "Ana is safe! The Doctor saved the day.";
    const saved = ctx("safe", { eliminatedNames: [], mayMentionDoctor: true });
    expect(reason("What a close call! The Doctor saved the day.", saved)).toBe("ok");
    expect(reason(line, ctx("safe"))).toBe("reveals_role");
  });
});

describe("narration checks: length and shape", () => {
  it("rejects anything that is not text, or is empty", () => {
    for (const bad of [undefined, null, 42, {}, [], "", "   ", "\n\t"]) expect(reason(bad, ctx("safe"))).toBe("empty");
  });

  it("allows 400 characters and no more", () => {
    const padding = (n: number) => `Ana was sent home. ${"La ".repeat(n)}`.slice(0, NARRATION_MAX_LENGTH);
    const exact = padding(200);
    expect([...exact]).toHaveLength(NARRATION_MAX_LENGTH);
    expect(reason(exact, ctx("safe"))).toBe("ok");
    expect(reason(`${exact}x`, ctx("safe"))).toBe("too_long");
    expect(reason(`Ana was sent home. ${"La ".repeat(500)}`, ctx("normal"))).toBe("too_long");
  });

  it("rejects markup, links and markdown", () => {
    for (const bad of [
      "<b>Ana</b> was sent home.",
      "Ana was sent home <script>alert(1)</script>",
      "Ana was sent home. See https://example.com now.",
      "Ana was sent home. Visit www.example.com",
      "**Ana** was sent home.",
      "# Morning news\nAna was sent home.",
      "Ana was sent home [click](http://x.y)",
    ]) {
      expect(reason(bad, ctx("safe")), bad).toBe("markup");
    }
  });

  it("tidies the text: one line, no emoji, no wrapping quotes", () => {
    expect(tidyNarration('  "Ana was sent home."  ')).toBe("Ana was sent home.");
    expect(tidyNarration("Ana was\nsent   home\r\n today.")).toBe("Ana was sent home today.");
    expect(tidyNarration("Ana was whisked away ✨🌙")).toBe("Ana was whisked away");
    expect(tidyNarration("Say \"hi\" to Ana, then \"bye\"")).toBe('Say "hi" to Ana, then "bye"');
    const result = checkNarration('"Ana was sent home by the Mafia."', ctx("safe"));
    expect(result).toEqual({ ok: true, text: "Ana was sent home by the Mafia." });
  });

  it("strips every kind of emoji and text face before anyone sees the narration", () => {
    const cases: Array<[string, string]> = [
      ["🌙 Ana was sent home 👋🏽.", "Ana was sent home."],
      ["Ana went home 👨‍👩‍👧 with the family.", "Ana went home with the family."],
      ["Ana flew home 🇫🇷 and waved 1️⃣ time.", "Ana flew home and waved 1 time."],
      ["Ana was sent home :) Sleep tight ;-) <3", "Ana was sent home Sleep tight"],
      ["Ana was sent home xD ^_^", "Ana was sent home"],
      ["❤️ Ana ❤ was sent home ☀︎", "Ana was sent home"],
    ];
    for (const [raw, clean] of cases) {
      expect(tidyNarration(raw), raw).toBe(clean);
      expect(hasEmoji(tidyNarration(raw)), raw).toBe(false);
    }
    const result = checkNarration("Ana was sent home by the Mafia 🕵️‍♂️🔪.", ctx("normal"));
    expect(result).toEqual({ ok: true, text: "Ana was sent home by the Mafia." });
  });

  it("keeps ordinary punctuation and times that look a little like faces", () => {
    expect(tidyNarration("At 10:30 the town woke (again). Ana: gone!")).toBe("At 10:30 the town woke (again). Ana: gone!");
  });

  it("tells the AI in both modes never to use emojis", () => {
    for (const mode of ["safe", "normal"] as const) {
      expect(NARRATOR_SYSTEM_PROMPT[mode]).toMatch(/Never use emojis, emoticons/);
      expect(NARRATOR_SYSTEM_PROMPT[mode]).toMatch(/no emojis/);
    }
  });
});

describe("narration checks: the victim's name", () => {
  it("must contain the name of everyone who left", () => {
    expect(reason("Somebody was whisked away in the night.", ctx("safe"))).toBe("missing_name");
    const two = ctx("safe", { eliminatedNames: ["Ana", "Ben"], otherNames: ["Cleo"] });
    expect(reason("Ana was whisked away.", two)).toBe("missing_name");
    expect(reason("Ana and Ben were whisked away.", two)).toBe("ok");
  });

  it("matches the name as a whole word, ignoring case", () => {
    const sam = ctx("safe", { eliminatedNames: ["Sam"] });
    expect(reason("Samuel was sent home.", sam)).toBe("missing_name");
    expect(reason("sam was sent home.", sam)).toBe("ok");
    expect(reason("Poor SAM was sent home.", sam)).toBe("ok");
  });

  it("handles names with spaces, punctuation and other alphabets", () => {
    for (const name of ["Mr. T (again)!", "Zoë O'Neil-Smith", "李雷", "Dee & Dee"]) {
      const c = ctx("normal", { eliminatedNames: [name], otherNames: [] });
      expect(reason(`By morning, ${name} was gone.`, c), name).toBe("ok");
      expect(reason("By morning, somebody was gone.", c), name).toBe("missing_name");
    }
  });

  it("never lets a nickname make a good line fail (names are not judged as words)", () => {
    const killer = ctx("safe", { eliminatedNames: ["Killer"] });
    expect(reason("Killer was whisked away in the night. Who will be next?", killer)).toBe("ok");
    // ...but the line itself is still judged
    expect(reason("Killer was killed in the night.", killer)).toBe("banned_word");
  });
});

describe("narration checks: Safe Mode bans violence, weapons, death and blood", () => {
  const safe = ctx("safe");
  const violent = [
    "Ana was killed in the night.",
    "Ana died in the night.",
    "Ana is dead.",
    "Ana met a sad death.",
    "Ana was shot at midnight.",
    "Ana was stabbed with a knife.",
    "Ana faced a gun.",
    "A sword was found by Ana.",
    "Ana was poisoned at dinner.",
    "There was blood on the floor and Ana was gone.",
    "A body was found, and it was Ana.",
    "Ana was murdered by the gang.",
    "Ana lost the fight.",
    "Ana was the victim of an attack.",
    "Ana was eliminated by the gang.",
    "Ana was eliminated.",
    "Ana was strangled.",
    "Ana was hurt badly.",
    "The weapon was a hammer, said Ana.",
    "Ana was K1LLED last night.",
    "Ana was ḱilled last night.",
    "Ana got a deadly surprise.",
    "Ana lies in the grave.",
    "A bomb went off near Ana.",
  ];
  for (const line of violent) {
    it(`rejects "${line}"`, () => expect(reason(line, safe)).toBe("banned_word"));
  }

  it("accepts the cartoony ways to leave the game", () => {
    for (const line of [
      "Ana was sent home by the Mafia!",
      "Ana was whisked away by the Sneaky Gang.",
      "Ana was caught by the Sneaky Gang and sent on a surprise holiday.",
      "Poof! Ana vanished in a puff of smoke.",
      "A friendly cloud swept Ana away to the seaside.",
    ]) {
      expect(reason(line, safe), line).toBe("ok");
    }
  });

  it("doesn't mistake harmless words for banned ones", () => {
    for (const line of [
      "Ana was sent home. Everybody skilled at hide and seek is still here.",
      "Ana was sent home, and nobody could diet away the sadness.",
      "Ana waved from the gravel path as the town clapped.",
      "Ana was sent home. The town hall clock struck nine.",
    ]) {
      expect(reason(line, safe), line).toBe("ok");
    }
  });
});

describe("narration checks: Normal Mode is noir, not gore or worse", () => {
  const normal = ctx("normal");

  it("allows crime-drama violence", () => {
    for (const line of [
      "A shot rang out and Ana was killed in the night.",
      "Ana was found at the docks, shot twice.",
      "Ana was poisoned at dinner, and the wine was still warm.",
      "Murder came to the town, and Ana was its victim.",
      "Ana lay dead in a back alley as the rain fell.",
    ]) {
      expect(reason(line, normal), line).toBe("ok");
    }
  });

  it("refuses gore and graphic injury", () => {
    for (const line of [
      "Ana was dismembered in the cellar.",
      "Ana was found with her guts on the floor.",
      "Ana's entrails were scattered in the alley.",
      "Ana was decapitated at the docks.",
      "Ana was tortured all night.",
      "Ana's body was mutilated beyond recognition.",
      "It was a bloodbath, and Ana was gone.",
    ]) {
      expect(reason(line, normal), line).toBe("banned_word");
    }
  });

  it("refuses sexual content and self-harm", () => {
    for (const line of [
      "Ana was found naked at the docks.",
      "Ana ran off after a sexual scandal.",
      "Ana chose suicide in the night.",
    ]) {
      expect(reason(line, normal), line).toBe("banned_word");
    }
  });
});

describe("narration checks: language, in both modes", () => {
  it("refuses profanity and slurs", () => {
    for (const mode of ["safe", "normal"] as const) {
      expect(reason("Ana was gone, and that is some shit.", ctx(mode))).toBe("profanity");
      expect(reason("Ana was gone, you stupid fuckers.", ctx(mode))).toBe("profanity");
    }
  });
});

describe("narration checks: no hidden information", () => {
  it("never allows another player's name: the narrator knows nothing about them", () => {
    for (const mode of ["safe", "normal"] as const) {
      expect(reason("Ana was sent home. Keep an eye on Ben.", ctx(mode))).toBe("mentions_other_player");
      expect(reason("Cleo and Ana were seen together.", ctx(mode))).toBe("mentions_other_player");
    }
  });

  it("doesn't confuse names with ordinary words or longer names", () => {
    const c = ctx("safe", { otherNames: ["Bo", "Ben", "Will"] });
    expect(reason("Ana was sent home. Who will be next?", c)).toBe("ok"); // "will" is not the name "Will"
    expect(reason("Ana was sent home. Bo-peep and Benjamin watched.", c)).toBe("ok"); // short or longer words
    expect(reason("Ana was sent home. Will watched.", c)).toBe("mentions_other_player");
  });

  it("never mentions roles", () => {
    for (const mode of ["safe", "normal"] as const) {
      for (const line of [
        "Ana was sent home. The detective frowned.",
        "Ana was gone, said the bodyguard.",
        "Cupid winked, and Ana was gone.",
        "A villager wept for Ana.",
        "The jester laughed at Ana's fate.",
        "Ana was gone. The doctor shrugged.",
      ]) {
        expect(reason(line, ctx(mode)), line).toBe("reveals_role");
      }
    }
  });

  it("never says that someone is (or isn't) Mafia", () => {
    for (const mode of ["safe", "normal"] as const) {
      expect(reason("Ana was the Mafia all along.", ctx(mode))).toBe("reveals_role");
      expect(reason("Ana was not a Sneaky Gang member.", ctx(mode, { mode }))).toBe("reveals_role");
      expect(reason("Ana is part of the gang.", ctx(mode))).toBe("reveals_role");
    }
  });

  it("still lets the narrator say the Mafia (or the gang) did it", () => {
    expect(reason("Ana was sent home by the Mafia.", ctx("safe"))).toBe("ok");
    expect(reason("Ana was whisked away by the Sneaky Gang.", ctx("safe"))).toBe("ok");
    expect(reason("The Mafia took Ana in the night, and the town is afraid.", ctx("normal"))).toBe("ok");
  });
});
