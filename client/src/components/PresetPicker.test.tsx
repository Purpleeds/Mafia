import { renderToStaticMarkup } from "react-dom/server";
import { defaultSettings, findBannedWord, presetPatch, type GameSettings } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { PresetPicker, presetName } from "./PresetPicker";

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");
const render = (settings: GameSettings, players = 8) =>
  renderToStaticMarkup(<PresetPicker settings={settings} playerCount={players} disabled={false} onApply={() => undefined} />);

describe("the preset picker", () => {
  it("speaks Safe Mode, with either name for the Mafia", () => {
    for (const sneakyGang of [false, true]) {
      const shown = text(render({ ...defaultSettings(), contentMode: "safe", sneakyGang }));
      expect(findBannedWord(shown, "safe"), shown).toBeNull();
      expect(shown).toContain(sneakyGang ? "the Sneaky Gang" : "the Mafia");
      for (const name of ["Classic", "Quick game", "Chaos"]) expect(shown).toContain(name);
    }
  });

  it("shows which preset is on, and 'Custom' once something changed", () => {
    const quick = { ...defaultSettings(), timers: presetPatch("quick").timers } as GameSettings;
    expect(presetName(defaultSettings())).toBe("Classic");
    expect(presetName(quick)).toBe("Quick game");
    expect(presetName({ ...defaultSettings(), showVotes: false })).toBe("Custom");
    expect(render(defaultSettings())).toMatch(/aria-pressed="true"[^>]*>\s*<span class="preset-name">Classic/);
  });

  it("warns when there are too few players for Chaos", () => {
    expect(text(render(defaultSettings(), 5))).toContain("Needs 6 or more players to start.");
    expect(text(render(defaultSettings(), 6))).not.toContain("Needs 6");
    // the presets that start at the game's own minimum don't repeat what the Start button says
    expect(text(render(defaultSettings(), 2)).match(/Needs \d+ or more/g)).toEqual(["Needs 6 or more"]);
  });
});
