import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeBrowser } from "./testing/fakeBrowser";

type SettingsModule = typeof import("./settings");

/** A fresh copy of the settings module, as if the page had just loaded with this saved data. */
async function load(saved?: string, options: Parameters<typeof installFakeBrowser>[0] = {}) {
  vi.resetModules();
  const browser = installFakeBrowser({ ...options, storage: saved === undefined ? {} : { "mafia.audio": saved } });
  const settings: SettingsModule = await import("./settings");
  return { browser, settings };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseAudioSettings", () => {
  it("gives the defaults when nothing was saved", async () => {
    const { settings } = await load();
    expect(settings.parseAudioSettings(null)).toEqual(settings.DEFAULT_AUDIO_SETTINGS);
    expect(settings.DEFAULT_AUDIO_SETTINGS).toEqual({ volume: 0.7, muted: false, ambience: true, effects: true, voice: false });
  });

  it("reads every saved value", async () => {
    const { settings } = await load();
    const saved = { volume: 0.25, muted: true, ambience: false, effects: false, voice: true };
    expect(settings.parseAudioSettings(JSON.stringify(saved))).toEqual(saved);
  });

  it("keeps the volume between 0 and 1", async () => {
    const { settings } = await load();
    expect(settings.parseAudioSettings('{"volume": 4}').volume).toBe(1);
    expect(settings.parseAudioSettings('{"volume": -3}').volume).toBe(0);
    expect(settings.parseAudioSettings('{"volume": 0}').volume).toBe(0);
  });

  it("ignores values of the wrong type, one by one", async () => {
    const { settings } = await load();
    const parsed = settings.parseAudioSettings('{"volume":"loud","muted":"yes","ambience":0,"effects":null,"voice":true}');
    expect(parsed).toEqual({ ...settings.DEFAULT_AUDIO_SETTINGS, voice: true });
  });

  it("falls back to the defaults for broken or unexpected data", async () => {
    const { settings } = await load();
    for (const bad of ["", "{", "not json", "null", "5", '"text"', "[1,2]", '{"volume":']) {
      expect(settings.parseAudioSettings(bad), bad).toEqual(settings.DEFAULT_AUDIO_SETTINGS);
    }
  });
});

describe("effectiveVolume", () => {
  it("is the volume, or silence when muted", async () => {
    const { settings } = await load();
    expect(settings.effectiveVolume({ ...settings.DEFAULT_AUDIO_SETTINGS, volume: 0.4 })).toBe(0.4);
    expect(settings.effectiveVolume({ ...settings.DEFAULT_AUDIO_SETTINGS, volume: 0.4, muted: true })).toBe(0);
  });
});

describe("the saved settings", () => {
  it("start from what localStorage held when the page loaded", async () => {
    const { settings } = await load('{"volume":0.3,"muted":true}');
    expect(settings.getAudioSettings()).toEqual({ ...settings.DEFAULT_AUDIO_SETTINGS, volume: 0.3, muted: true });
  });

  it("are written to localStorage under 'mafia.audio' when they change", async () => {
    const { settings, browser } = await load();
    expect(browser.storage.has("mafia.audio")).toBe(false);
    settings.setAudioSettings({ muted: true });
    settings.setAudioSettings({ volume: 0.4 });
    expect(JSON.parse(browser.storage.get("mafia.audio") ?? "null")).toEqual({
      volume: 0.4,
      muted: true,
      ambience: true,
      effects: true,
      voice: false,
    });
  });

  it("survive a reload", async () => {
    const first = await load();
    first.settings.setAudioSettings({ volume: 0.15, muted: true, voice: true });
    const saved = first.browser.storage.get("mafia.audio");
    vi.unstubAllGlobals();
    const second = await load(saved);
    expect(second.settings.getAudioSettings()).toEqual({ volume: 0.15, muted: true, ambience: true, effects: true, voice: true });
  });

  it("clamp the volume when it is set", async () => {
    const { settings } = await load();
    settings.setAudioSettings({ volume: 5 });
    expect(settings.getAudioSettings().volume).toBe(1);
    settings.setAudioSettings({ volume: -1 });
    expect(settings.getAudioSettings().volume).toBe(0);
  });

  it("tell listeners once per real change, and not at all when nothing changed", async () => {
    const { settings } = await load();
    const listener = vi.fn();
    const stop = settings.subscribeAudioSettings(listener);
    settings.setAudioSettings({ volume: 0.7 }); // already 0.7
    settings.setAudioSettings({});
    expect(listener).not.toHaveBeenCalled();
    settings.setAudioSettings({ muted: true });
    expect(listener).toHaveBeenCalledTimes(1);
    settings.setAudioSettings({ muted: true });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    settings.setAudioSettings({ muted: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("still change for this visit when storage is blocked", async () => {
    const { settings } = await load(undefined, { blockedStorage: true });
    expect(settings.getAudioSettings()).toEqual(settings.DEFAULT_AUDIO_SETTINGS);
    expect(() => settings.setAudioSettings({ muted: true, volume: 0.2 })).not.toThrow();
    expect(settings.getAudioSettings()).toMatchObject({ muted: true, volume: 0.2 });
  });

  it("can be re-read after something else changed the stored value", async () => {
    const { settings, browser } = await load();
    const listener = vi.fn();
    settings.subscribeAudioSettings(listener);
    browser.storage.set("mafia.audio", '{"volume":0.9,"muted":true}');
    settings.reloadAudioSettings();
    expect(settings.getAudioSettings()).toMatchObject({ volume: 0.9, muted: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
