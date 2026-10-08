import { renderToStaticMarkup } from "react-dom/server";
import { findBannedWord, type DeathCause, type GangName, type Role, type Winner } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { FxSettings } from "../components/FxSettings";
import { HowToPlayContent, RoleGuideContent } from "../components/RulesContent";
import { SoundPanel } from "../components/SoundControls";
import { MODE_INFO, NIGHT_PROMPT, NIGHT_VERB } from "./copy";
import { ROLE_INFO, ROLE_ORDER } from "./roles";
import {
  OUTSIDE_A_ROOM,
  deathCause,
  fill,
  gangOf,
  isGangMember,
  nightOutcomeLabel,
  roleLabel,
  teamLabel,
  tieRuleLabel,
  timelineDeath,
  winnerLabel,
  wordsFor,
  type WordingSettings,
} from "./wording";

const SAFE: WordingSettings = { contentMode: "safe", sneakyGang: false };
const SAFE_SNEAKY: WordingSettings = { contentMode: "safe", sneakyGang: true };
const NORMAL: WordingSettings = { contentMode: "normal", sneakyGang: false };
const NORMAL_SNEAKY: WordingSettings = { contentMode: "normal", sneakyGang: true };

const CAUSES: DeathCause[] = ["mafia", "vote", "heartbreak"];
const WINNERS: Winner[] = ["town", "mafia", "jester"];

const textOf = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");

describe("the Mafia's name", () => {
  it("is Mafia, or Sneaky Gang when the host chose it in Safe Mode", () => {
    expect(gangOf(SAFE)).toBe<GangName>("Mafia");
    expect(gangOf(SAFE_SNEAKY)).toBe<GangName>("Sneaky Gang");
    // Normal Mode keeps the classic name whatever is stored
    expect(gangOf(NORMAL)).toBe("Mafia");
    expect(gangOf(NORMAL_SNEAKY)).toBe("Mafia");
  });

  it("reaches every label", () => {
    expect(roleLabel("mafia", SAFE_SNEAKY)).toBe("Sneaky Gang");
    expect(roleLabel("mafia", SAFE)).toBe("Mafia");
    expect(roleLabel("doctor", SAFE_SNEAKY)).toBe("Doctor");
    expect(teamLabel("mafia", SAFE_SNEAKY)).toBe("Sneaky Gang");
    expect(teamLabel("town", SAFE_SNEAKY)).toBe("Town");
    expect(winnerLabel("mafia", SAFE_SNEAKY)).toBe("The Sneaky Gang wins!");
    expect(winnerLabel("mafia", NORMAL_SNEAKY)).toBe("The Mafia wins!");
    expect(isGangMember(true, SAFE_SNEAKY)).toBe("Sneaky Gang");
    expect(isGangMember(false, SAFE_SNEAKY)).toBe("not Sneaky Gang");
    expect(deathCause("mafia", SAFE_SNEAKY).text).toBe("Sent home by the Sneaky Gang");
    expect(fill("{TheGang} win. {theGang}! {gang}.", SAFE_SNEAKY)).toBe("The Sneaky Gang win. the Sneaky Gang! Sneaky Gang.");
  });

  it("changes every role's text, in every place the Mafia are mentioned", () => {
    for (const role of ROLE_ORDER) {
      const info = ROLE_INFO[role];
      for (const mode of ["safe", "normal"] as const) {
        const texts = [info.summary[mode], info.ability[mode], info.goal, info.tip[mode]];
        for (const text of texts) {
          expect(fill(text, SAFE_SNEAKY), `${role} ${mode}`).not.toContain("{");
          if (mode === "safe") expect(fill(text, SAFE_SNEAKY), `${role}: ${text}`).not.toMatch(/\bMafia\b/);
        }
      }
    }
  });
});

describe("Safe Mode never shows weapons, death, blood or violence words", () => {
  for (const settings of [SAFE, SAFE_SNEAKY]) {
    const label = settings.sneakyGang ? "Safe Mode, Sneaky Gang" : "Safe Mode";

    it(`has clean wording tables (${label})`, () => {
      const w = wordsFor(settings);
      const strings: string[] = [
        w.outTag,
        w.outBanner,
        w.outBannerNight,
        w.outChatTab,
        w.outChatPlaceholder,
        w.outChatEmpty,
        w.outChatNote,
        w.tieNone,
        w.revealLabel,
        w.revealHint,
        w.revealSummary,
        fill(w.wentAfter, settings),
        w.mafiaVerb,
        MODE_INFO.safe.label,
        MODE_INFO.safe.shortLabel,
        MODE_INFO.safe.blurb,
        MODE_INFO.safe.description,
        ...Object.values(NIGHT_PROMPT.safe),
        ...Object.values(NIGHT_VERB.safe),
        ...Object.values(w.tieRule),
      ];
      for (const cause of CAUSES) {
        strings.push(deathCause(cause, settings).text, timelineDeath("Ana", " (Villager)", cause, settings));
      }
      for (const outcome of ["no_attack", "saved", "guarded", "killed"] as const) strings.push(nightOutcomeLabel(outcome, settings));
      for (const winner of WINNERS) strings.push(winnerLabel(winner, settings));
      for (const rule of ["no_elimination", "revote"] as const) strings.push(tieRuleLabel(rule, settings));
      for (const role of ["mafia", "doctor", "detective", "villager", "jester", "bodyguard", "cupid"] as Role[]) {
        strings.push(roleLabel(role, settings), teamLabel(ROLE_INFO[role].team, settings));
      }
      for (const text of strings) expect(findBannedWord(text, "safe"), text).toBeNull();
    });

    it(`has clean role descriptions (${label})`, () => {
      for (const role of ROLE_ORDER) {
        const info = ROLE_INFO[role];
        for (const text of [info.summary.safe, info.ability.safe, info.goal, info.tip.safe]) {
          const filled = fill(text, settings);
          expect(findBannedWord(filled, "safe"), `${role}: ${filled}`).toBeNull();
        }
      }
    });

    it(`has clean how-to-play and role-guide pages (${label})`, () => {
      const how = textOf(renderToStaticMarkup(<HowToPlayContent settings={settings} />));
      expect(findBannedWord(how, "safe"), how).toBeNull();
      const guide = textOf(renderToStaticMarkup(<RoleGuideContent initialMode="safe" settings={settings} />));
      expect(findBannedWord(guide, "safe"), guide).toBeNull();
    });
  }

  it("says 'sent home' where Normal Mode says 'eliminated'", () => {
    expect(wordsFor(SAFE).outTag).toBe("Sent home");
    expect(wordsFor(NORMAL).outTag).toBe("Eliminated");
    expect(tieRuleLabel("no_elimination", SAFE)).toBe("Nobody goes home");
    expect(timelineDeath("Ana", "", "mafia", SAFE)).toBe("Ana was sent home by the Mafia.");
    expect(timelineDeath("Ana", "", "mafia", NORMAL)).toBe("Ana was eliminated by the Mafia.");
    expect(wordsFor(SAFE).outChatTab).toBe("Back Home");
    expect(wordsFor(NORMAL).outChatTab).toBe("Graveyard");
  });
});

describe("Normal Mode keeps its crime-drama words", () => {
  it("has the classic wording", () => {
    expect(deathCause("mafia", NORMAL).text).toBe("Killed in the night");
    expect(deathCause("heartbreak", NORMAL).text).toBe("Died of a broken heart");
    expect(NIGHT_PROMPT.normal.kill).toBe("Choose who to eliminate");
    const how = textOf(renderToStaticMarkup(<HowToPlayContent settings={NORMAL} />));
    expect(how).toContain("eliminate the Town");
    expect(how).toContain("film-noir");
  });
});

describe("outside a room", () => {
  it("the how-to-play page speaks Safe Mode with the usual name", () => {
    expect(OUTSIDE_A_ROOM).toEqual({ contentMode: "safe", sneakyGang: false });
    const how = textOf(renderToStaticMarkup(<HowToPlayContent />));
    expect(how).toContain("send the Town home");
    expect(how).not.toMatch(/eliminat/i);
  });

  it("the how-to-play text follows the Sneaky Gang rename inside a room", () => {
    const how = textOf(renderToStaticMarkup(<HowToPlayContent settings={SAFE_SNEAKY} />));
    expect(how).toContain("Sneaky Gang");
    expect(how).not.toContain("Mafia try");
  });
});

describe("the role guide inside a game", () => {
  it("only shows the room's own wording: a Safe Mode player can't switch to Normal Mode's words", () => {
    for (const settings of [SAFE, SAFE_SNEAKY]) {
      const html = renderToStaticMarkup(<RoleGuideContent initialMode="safe" settings={settings} lockMode />);
      expect(html).not.toContain("Wording");
      expect(html).not.toContain("aria-pressed");
      const guide = textOf(html);
      expect(findBannedWord(guide, "safe"), guide).toBeNull();
      expect(guide).not.toContain("Normal Mode");
      expect(guide).not.toMatch(/kill|eliminat/i);
    }
  });

  it("is Normal Mode's wording, with no way to flip to Safe Mode's, in a Normal Mode room", () => {
    const html = renderToStaticMarkup(<RoleGuideContent initialMode="normal" settings={NORMAL} lockMode />);
    expect(html).not.toContain("aria-pressed");
    expect(textOf(html)).toMatch(/kill|eliminat/i);
  });

  it("is still switchable on the role-guide page, which starts in Safe Mode wording", () => {
    const html = renderToStaticMarkup(<RoleGuideContent />);
    expect(html).toContain("Wording");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    const guide = textOf(html);
    expect(findBannedWord(guide.replace(/Normal Mode/g, ""), "safe"), guide).toBeNull();
  });
});

describe("the controls every player sees, in any room", () => {
  it("use no words Safe Mode doesn't allow (sound and background settings)", () => {
    for (const html of [renderToStaticMarkup(<SoundPanel idPrefix="t" />), renderToStaticMarkup(<FxSettings idPrefix="t" />)]) {
      const text = textOf(html);
      expect(text.length).toBeGreaterThan(20);
      expect(findBannedWord(text, "safe"), text).toBeNull();
    }
  });
});
