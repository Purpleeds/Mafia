import { findBannedWord, type ContentMode, type GangName, type NarrationFacts } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../game/rng.js";
import { checkNarration } from "./checks.js";
import { SITUATIONS, TEMPLATES, pickTemplate, renderTemplate, situationOf, templateVars, type Situation } from "./templates.js";

const MODES: ContentMode[] = ["safe", "normal"];
const GANGS: GangName[] = ["Mafia", "Sneaky Gang"];

function facts(mode: ContentMode, patch: Partial<NarrationFacts> = {}): NarrationFacts {
  return {
    kind: "night",
    mode,
    round: 1,
    gang: "Mafia",
    eliminated: [{ name: "Ana", how: "night" }],
    saved: false,
    voteOutcome: null,
    ...patch,
  };
}

/** Facts that land in each pool of lines. */
function factsFor(mode: ContentMode, situation: Situation, gang: GangName = "Mafia"): NarrationFacts {
  const one = [{ name: "Ana", how: "night" as const }];
  const pair = [
    { name: "Ana", how: "night" as const },
    { name: "Ben", how: "heartbreak" as const },
  ];
  const trio = [...pair, { name: "Cy", how: "night" as const }];
  const kind = situation.startsWith("night") ? "night" : "vote";
  const how = (list: NarrationFacts["eliminated"]): NarrationFacts["eliminated"] =>
    list.map((e) => ({ ...e, how: kind === "vote" && e.how === "night" ? "vote" : e.how }));
  const base = { mode, gang, kind } as const;
  switch (situation) {
    case "night_one":
      return facts(mode, { ...base, eliminated: one });
    case "night_heartbreak":
      return facts(mode, { ...base, eliminated: pair });
    case "night_many":
      return facts(mode, { ...base, eliminated: trio });
    case "night_saved":
      return facts(mode, { ...base, eliminated: [], saved: true });
    case "night_quiet":
      return facts(mode, { ...base, eliminated: [] });
    case "vote_one":
      return facts(mode, { ...base, eliminated: how(one), voteOutcome: "eliminated" });
    case "vote_heartbreak":
      return facts(mode, { ...base, eliminated: how(pair), voteOutcome: "eliminated" });
    case "vote_many":
      return facts(mode, { ...base, eliminated: how(trio), voteOutcome: "eliminated" });
    case "vote_skip":
      return facts(mode, { ...base, eliminated: [], voteOutcome: "skipped" });
    case "vote_tie":
      return facts(mode, { ...base, eliminated: [], voteOutcome: "tie" });
    case "vote_nobody":
      return facts(mode, { ...base, eliminated: [], voteOutcome: "nobody" });
  }
}

describe("template library", () => {
  it("has plenty of lines for each mode (the morning news alone has 15 or more)", () => {
    for (const mode of MODES) {
      expect(TEMPLATES[mode].night_one.length).toBeGreaterThanOrEqual(15);
      const total = SITUATIONS.reduce((sum, s) => sum + TEMPLATES[mode][s].length, 0);
      expect(total).toBeGreaterThanOrEqual(40);
      for (const situation of SITUATIONS) expect(TEMPLATES[mode][situation].length, `${mode} ${situation}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("has no duplicate lines", () => {
    const all = MODES.flatMap((m) => SITUATIONS.flatMap((s) => TEMPLATES[m][s]));
    expect(new Set(all).size).toBe(all.length);
  });

  it("uses the right placeholders for the situation", () => {
    const needs: Record<Situation, string[]> = {
      night_one: ["{name}"],
      night_heartbreak: ["{name}", "{other}"],
      night_many: ["{names}"],
      night_saved: [],
      night_quiet: [],
      vote_one: ["{name}"],
      vote_heartbreak: ["{name}", "{other}"],
      vote_many: ["{names}"],
      vote_skip: [],
      vote_tie: [],
      vote_nobody: [],
    };
    for (const mode of MODES) {
      for (const situation of SITUATIONS) {
        for (const line of TEMPLATES[mode][situation]) {
          const used = [...line.matchAll(/\{(\w+)\}/g)].map((m) => `{${m[1]}}`);
          for (const placeholder of used) {
            expect(["{name}", "{other}", "{names}", "{gang}", "{Gang}"], line).toContain(placeholder);
          }
          for (const required of needs[situation]) expect(line, `${mode} ${situation}`).toContain(required);
          if (needs[situation].length === 0) {
            expect(used.filter((p) => ["{name}", "{other}", "{names}"].includes(p)), line).toEqual([]);
          }
        }
      }
    }
  });

  it("passes the narration checks of its own mode, for every line and both names for the gang", () => {
    for (const mode of MODES) {
      for (const situation of SITUATIONS) {
        for (const gang of GANGS) {
          const f = factsFor(mode, situation, gang);
          const names = f.eliminated.map((e) => e.name);
          for (let i = 0; i < TEMPLATES[mode][situation].length; i++) {
            const text = renderTemplate(TEMPLATES[mode][situation][i] ?? "", templateVars(f));
            expect(text, text).not.toContain("{");
            const result = checkNarration(text, {
              mode,
              eliminatedNames: names,
              otherNames: ["Dee", "Eve", "Fay"],
              mayMentionDoctor: f.saved,
            });
            expect(result, `${mode}.${situation}.${i}: ${text}`).toEqual({ ok: true, text });
          }
        }
      }
    }
  });

  it("keeps Safe Mode lines free of violence, weapons, death and blood", () => {
    for (const situation of SITUATIONS) {
      for (const line of TEMPLATES.safe[situation]) {
        const plain = line.replace(/\{\w+\}/g, "x");
        expect(findBannedWord(plain, "safe"), line).toBeNull();
      }
    }
  });

  it("keeps Normal Mode lines noir but free of gore and sexual content", () => {
    for (const situation of SITUATIONS) {
      for (const line of TEMPLATES.normal[situation]) {
        const plain = line.replace(/\{\w+\}/g, "x");
        expect(findBannedWord(plain, "normal"), line).toBeNull();
      }
    }
    // The crime-drama vocabulary is really there.
    const text = TEMPLATES.normal.night_one.join(" ").toLowerCase();
    for (const word of ["shot", "docks", "dinner"]) expect(text).toContain(word);
  });

  it("has the cartoony Safe Mode phrases", () => {
    const text = SITUATIONS.flatMap((s) => TEMPLATES.safe[s]).join(" ").toLowerCase();
    for (const phrase of ["sent home", "whisked away", "surprise holiday", "sneaky"]) expect(text).toContain(phrase);
    expect(TEMPLATES.safe.night_one[0]).toBe("{name} was whisked away in the night by {gang}. Who will be next?");
    expect(TEMPLATES.normal.night_one[0]).toBe("A single shot rang out across the town. By morning, {name} was gone.");
  });
});

describe("choosing a line", () => {
  it("fits the situation", () => {
    const sit = (patch: Partial<NarrationFacts>) => situationOf(facts("safe", patch));
    expect(sit({})).toBe("night_one");
    expect(sit({ eliminated: [], saved: true })).toBe("night_saved");
    expect(sit({ eliminated: [] })).toBe("night_quiet");
    expect(sit({ eliminated: [{ name: "A", how: "night" }, { name: "B", how: "heartbreak" }] })).toBe("night_heartbreak");
    expect(sit({ eliminated: [{ name: "A", how: "night" }, { name: "B", how: "night" }] })).toBe("night_many");
    const vote = { kind: "vote" as const };
    expect(sit({ ...vote, eliminated: [{ name: "A", how: "vote" }], voteOutcome: "eliminated" })).toBe("vote_one");
    expect(sit({ ...vote, eliminated: [], voteOutcome: "skipped" })).toBe("vote_skip");
    expect(sit({ ...vote, eliminated: [], voteOutcome: "tie" })).toBe("vote_tie");
    expect(sit({ ...vote, eliminated: [], voteOutcome: "nobody" })).toBe("vote_nobody");
  });

  it("fills in the names, and the gang's name", () => {
    expect(templateVars(facts("safe", { gang: "Sneaky Gang" }))).toMatchObject({
      name: "Ana",
      gang: "the Sneaky Gang",
      Gang: "The Sneaky Gang",
    });
    const two = templateVars(facts("safe", { eliminated: [{ name: "Ana", how: "night" }, { name: "Ben", how: "heartbreak" }] }));
    expect(two).toMatchObject({ name: "Ana", other: "Ben", names: "Ana and Ben" });
    const three = templateVars(
      facts("safe", { eliminated: ["A", "B", "C"].map((name) => ({ name, how: "night" as const })) }),
    );
    expect(three.names).toBe("A, B and C");
  });

  it("never repeats a line within a game, for every pool", () => {
    for (const mode of MODES) {
      for (const situation of SITUATIONS) {
        const f = factsFor(mode, situation);
        const used: string[] = [];
        const rng = mulberry32(7);
        const size = TEMPLATES[mode][situation].length;
        const texts = new Set<string>();
        for (let i = 0; i < size; i++) {
          const pick = pickTemplate(f, used, rng);
          expect(pick.restarted).toBe(false);
          expect(used).not.toContain(pick.id);
          used.push(pick.id);
          texts.add(pick.text);
        }
        expect(texts.size, `${mode} ${situation}`).toBe(size);
      }
    }
  });

  it("starts a pool over when it runs out, without repeating the line used last", () => {
    const f = factsFor("safe", "vote_skip");
    const size = TEMPLATES.safe.vote_skip.length;
    let used: string[] = [];
    const rng = mulberry32(5);
    let last = "";
    for (let i = 0; i < size * 4; i++) {
      const pick = pickTemplate(f, used, rng);
      if (pick.restarted) used = used.filter((id) => !pick.poolIds.includes(id));
      expect(pick.id).not.toBe(last);
      last = pick.id;
      used.push(pick.id);
    }
  });

  it("is repeatable for a given random seed", () => {
    const f = factsFor("normal", "night_one");
    expect(pickTemplate(f, [], mulberry32(11)).text).toBe(pickTemplate(f, [], mulberry32(11)).text);
  });
});
