import { filterChatText } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, displayChatText, parsePrefs } from "./prefs";

describe("the personal 'Hide strong language for me' filter", () => {
  const raw = "damn, that was a shit move you idiot";

  it("is off by default and leaves messages as the server sent them", () => {
    expect(DEFAULT_PREFS.hideStrongLanguage).toBe(false);
    expect(displayChatText(raw, { hideStrongLanguage: false })).toBe(raw);
  });

  it("hides strong and milder words on this screen when on", () => {
    expect(displayChatText(raw, { hideStrongLanguage: true })).toBe("****, that was a **** move you *****");
    expect(displayChatText("you fucking cheat", { hideStrongLanguage: true })).toBe("you ******* cheat");
  });

  it("works whatever the host chose: an uncensored message is hidden on this screen only", () => {
    const fromUncensoredRoom = filterChatText(raw, "uncensored");
    expect(fromUncensoredRoom).toBe(raw);
    expect(displayChatText(fromUncensoredRoom, { hideStrongLanguage: true })).not.toMatch(/shit|damn|idiot/);
    // A message the server already filtered stays filtered.
    const fromStandardRoom = filterChatText(raw, "standard");
    expect(displayChatText(fromStandardRoom, { hideStrongLanguage: true })).toBe("****, that was a **** move you *****");
  });

  it("leaves ordinary words alone (no 'Scunthorpe problem')", () => {
    for (const text of ["hello shell", "class assassin from Scunthorpe", "I'm going to the hellenic museum", "glass of water"]) {
      expect(displayChatText(text, { hideStrongLanguage: true })).toBe(text);
    }
  });

  it("is remembered on this device, ignoring anything broken", () => {
    expect(parsePrefs(JSON.stringify({ hideStrongLanguage: true, haptics: false }))).toEqual({
      ...DEFAULT_PREFS,
      hideStrongLanguage: true,
      haptics: false,
    });
    expect(parsePrefs("{nope")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ hideStrongLanguage: "yes" }))).toEqual(DEFAULT_PREFS);
  });
});

describe("the chat filter levels", () => {
  it("hide more the stricter they are", () => {
    const text = "damn this shit, just kys";
    expect(filterChatText(text, "uncensored")).toBe(text);
    expect(filterChatText(text, "standard")).toBe("damn this ****, just ***");
    expect(filterChatText(text, "strict")).toBe("**** this ****, just ***");
  });
});
