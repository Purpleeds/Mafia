import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext } from "./testing/fakeAudio";
import { FakeElement, installFakeBrowser, type FakeBrowser, type FakeBrowserOptions } from "./testing/fakeBrowser";

type EngineModule = typeof import("./engine");
type SceneModule = typeof import("../fx/scene");
type SettingsModule = typeof import("./settings");

interface Page {
  browser: FakeBrowser;
  engine: EngineModule;
  scene: SceneModule;
  settings: SettingsModule;
  /** The page's audio context (undefined until the first tap). */
  ctx: () => FakeAudioContext | undefined;
  stats: () => ReturnType<EngineModule["audio"]["stats"]>;
}

/** A page that has just loaded: fresh modules, fresh browser, the sound engine listening for a tap. */
async function openPage(options: FakeBrowserOptions & { saved?: Record<string, unknown> } = {}): Promise<Page> {
  vi.resetModules();
  FakeAudioContext.instances.length = 0;
  FakeAudioContext.startsRunning = true;
  const { saved, ...rest } = options;
  const browser = installFakeBrowser({ ...rest, storage: saved ? { "mafia.audio": JSON.stringify(saved) } : {} });
  const engine = await import("./engine");
  const scene = await import("../fx/scene");
  const settings = await import("./settings");
  engine.initAudio();
  return {
    browser,
    engine,
    scene,
    settings,
    ctx: () => FakeAudioContext.instances[0],
    stats: () => engine.audio.stats(),
  };
}

const button = (attrs: Record<string, string> = {}, parent: FakeElement | null = null) => new FakeElement("button", attrs, parent);

/** Opens a page and makes the first tap, so sound is allowed. */
async function openUnlocked(options: Parameters<typeof openPage>[0] = {}): Promise<Page> {
  const page = await openPage(options);
  page.browser.press(new FakeElement("div"));
  return page;
}

// The engine's first three gain nodes, in the order it builds them: master, background bus, effects bus.
const masterGain = (page: Page) => page.ctx()?.all("gain")[0];
const ambienceBus = (page: Page) => page.ctx()?.all("gain")[1];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("before the first tap", () => {
  it("makes no audio context and plays nothing", async () => {
    const page = await openPage();
    expect(page.ctx()).toBeUndefined();
    expect(page.stats()).toMatchObject({ state: "none", unlocked: false, ambienceRunning: false, played: {} });
    page.engine.audio.play("click");
    page.engine.sounds.vote();
    page.engine.sounds.tick(5);
    page.engine.sounds.ending(true, "safe");
    page.scene.emitFx({ kind: "save" });
    expect(page.ctx()).toBeUndefined();
    expect(page.stats().played).toEqual({});
  });

  it("publishes its stats for debugging", async () => {
    const page = await openPage();
    expect(page.browser.window.__mafiaAudio).toMatchObject({ state: "none", unlocked: false, volume: 0.7, muted: false });
  });

  it("can be started more than once without listening twice", async () => {
    const page = await openPage();
    page.engine.initAudio();
    page.engine.initAudio();
    expect(page.browser.window.listenerCount("pointerdown")).toBe(1);
  });
});

describe("the first tap", () => {
  it.each(["pointerdown", "touchend", "keydown", "click"])("a %s creates the context and starts the background", async (gesture) => {
    const page = await openPage();
    page.browser.window.dispatch(gesture, { target: null });
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(page.stats()).toMatchObject({ state: "running", unlocked: true, ambienceRunning: true });
  });

  it("creates the context only once, however many taps follow", async () => {
    const page = await openPage();
    for (let i = 0; i < 5; i++) page.browser.press(new FakeElement("div"));
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("asks for low latency, and builds master, background and effects volumes into a compressor", async () => {
    const page = await openUnlocked();
    const ctx = page.ctx();
    expect(ctx?.options).toMatchObject({ latencyHint: "interactive" });
    expect(ctx?.all("compressor")).toHaveLength(1);
    expect(ctx?.all("compressor")[0]?.outputs).toContain(ctx?.destination);
  });

  it("copes with a browser without Web Audio, or one that refuses to make a context", async () => {
    for (const options of [{ noAudio: true }, { audioThrows: true }]) {
      const page = await openPage(options);
      expect(() => page.browser.press(new FakeElement("div"))).not.toThrow();
      expect(page.stats()).toMatchObject({ unlocked: false, state: "none" });
      expect(() => page.engine.audio.play("click")).not.toThrow();
    }
  });

  it("wakes a context the browser left suspended", async () => {
    const page = await openPage();
    FakeAudioContext.startsRunning = false;
    page.browser.press(new FakeElement("div"));
    expect(page.ctx()?.state).toBe("suspended");
    await vi.advanceTimersByTimeAsync(0);
    expect(page.ctx()?.state).toBe("running");
    expect(page.stats().state).toBe("running");
  });

  it("applies the scene that was set before the tap", async () => {
    const page = await openPage();
    page.scene.setScene({ mode: "safe", phase: "NIGHT", winner: null });
    page.browser.press(new FakeElement("div"));
    expect(page.stats().dayAmount).toBe(0);
  });
});

describe("clicks", () => {
  it("a press on a button makes a click (and the very first press counts too)", async () => {
    const page = await openPage();
    page.browser.press(button());
    expect(page.stats().played.click).toBe(1);
    page.browser.press(button());
    expect(page.stats().played.click).toBe(2);
  });

  it("covers links, switches, tabs, checkboxes and player cards, and their children", async () => {
    const page = await openUnlocked();
    const targets = [
      new FakeElement("a", { href: "/x" }),
      new FakeElement("div", { role: "switch" }),
      new FakeElement("div", { role: "tab" }),
      new FakeElement("input", { type: "checkbox" }),
      new FakeElement("input", { type: "radio" }),
      new FakeElement("div", { class: "pcard pcard-skip" }),
      new FakeElement("span", {}, button()), // a label inside a button
    ];
    for (const target of targets) page.browser.press(target);
    expect(page.stats().played.click).toBe(targets.length);
  });

  it("is silent for plain text and for anything that isn't an element", async () => {
    const page = await openUnlocked();
    page.browser.press(new FakeElement("p"));
    page.browser.press(new FakeElement("a")); // a link without an address
    page.browser.press(null);
    expect(page.stats().played.click).toBeUndefined();
  });

  it("is silent for disabled buttons", async () => {
    const page = await openUnlocked();
    const disabled = button();
    disabled.disabled = true;
    page.browser.press(disabled);
    page.browser.press(button({ "aria-disabled": "true" }));
    expect(page.stats().played.click).toBeUndefined();
  });

  it("is silent for anything marked data-sound=none (a button that makes its own sound)", async () => {
    const page = await openUnlocked();
    page.browser.press(button({ "data-sound": "none" }));
    page.browser.press(new FakeElement("span", {}, button({ "data-sound": "none" })));
    expect(page.stats().played.click).toBeUndefined();
  });
});

describe("volume and mute", () => {
  it("sets the speakers to the volume", async () => {
    const page = await openUnlocked({ saved: { volume: 0.35 } });
    const events = masterGain(page)?.gain.events ?? [];
    expect(events.at(-1)).toMatchObject({ method: "setTargetAtTime", value: 0.35 });
    page.settings.setAudioSettings({ volume: 0.6 });
    expect(masterGain(page)?.gain.events.at(-1)).toMatchObject({ method: "setTargetAtTime", value: 0.6 });
    expect(page.stats().volume).toBe(0.6);
  });

  it("mute silences the speakers, the effects, then lets the hardware sleep", async () => {
    const page = await openUnlocked();
    page.settings.setAudioSettings({ muted: true });
    expect(masterGain(page)?.gain.events.at(-1)).toMatchObject({ method: "setTargetAtTime", value: 0 });
    page.engine.audio.play("click");
    page.engine.sounds.vote();
    expect(page.stats().played).toEqual({});
    expect(page.stats()).toMatchObject({ muted: true, ambienceRunning: false });
    expect(page.ctx()?.state).toBe("running"); // the fade out has to finish first
    await vi.advanceTimersByTimeAsync(400);
    expect(page.ctx()?.state).toBe("suspended");
    expect(page.stats().state).toBe("suspended");
  });

  it("unmute wakes it again, with the background back", async () => {
    const page = await openUnlocked();
    page.settings.setAudioSettings({ muted: true });
    await vi.advanceTimersByTimeAsync(400);
    page.settings.setAudioSettings({ muted: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(page.ctx()?.state).toBe("running");
    expect(page.stats()).toMatchObject({ muted: false, ambienceRunning: true });
    page.engine.audio.play("click");
    expect(page.stats().played.click).toBe(1);
  });

  it("a volume of zero is the same as mute", async () => {
    const page = await openUnlocked();
    page.settings.setAudioSettings({ volume: 0 });
    page.engine.audio.play("click");
    expect(page.stats().played).toEqual({});
    await vi.advanceTimersByTimeAsync(400);
    expect(page.ctx()?.state).toBe("suspended");
  });

  it("remembered settings are honoured from the first tap", async () => {
    const page = await openUnlocked({ saved: { muted: true, volume: 0.3 } });
    expect(page.stats()).toMatchObject({ muted: true, volume: 0.3 });
    expect(masterGain(page)?.gain.events.at(-1)).toMatchObject({ value: 0 });
    page.browser.press(button());
    expect(page.stats().played).toEqual({});
    await vi.advanceTimersByTimeAsync(400);
    expect(page.ctx()?.state).toBe("suspended");
  });
});

describe("the background and effects switches", () => {
  it("turning the background off stops its scheduling but keeps effects", async () => {
    const page = await openUnlocked();
    expect(page.stats().ambienceRunning).toBe(true);
    page.settings.setAudioSettings({ ambience: false });
    expect(page.stats().ambienceRunning).toBe(false);
    expect(ambienceBus(page)?.gain.events.at(-1)).toMatchObject({ method: "setTargetAtTime", value: 0 });
    page.engine.audio.play("click");
    expect(page.stats().played.click).toBe(1);
    page.settings.setAudioSettings({ ambience: true });
    expect(page.stats().ambienceRunning).toBe(true);
    expect(ambienceBus(page)?.gain.events.at(-1)).toMatchObject({ value: 0.5 });
  });

  it("turning effects off silences clicks, votes, ticks and eliminations but not the background", async () => {
    const page = await openUnlocked();
    page.settings.setAudioSettings({ effects: false });
    page.engine.audio.play("click");
    page.engine.sounds.vote();
    page.engine.sounds.tick(2);
    page.engine.sounds.ending(true, "normal");
    page.scene.emitFx({ kind: "eliminate", mode: "safe" });
    expect(page.stats().played).toEqual({});
    expect(page.stats().ambienceRunning).toBe(true);
  });

  it("keeps scheduling the background while the clock runs", async () => {
    const page = await openUnlocked();
    const before = page.ctx()?.nodes.length ?? 0;
    const ctx = page.ctx();
    if (!ctx) throw new Error("no context");
    for (let i = 0; i < 20; i++) {
      ctx.currentTime += 0.3;
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(ctx.nodes.length).toBeGreaterThan(before);
  });
});

describe("a hidden tab", () => {
  it("stops the background and the effects, and lets the hardware sleep", async () => {
    const page = await openUnlocked();
    page.browser.setVisibility("hidden");
    expect(page.stats().ambienceRunning).toBe(false);
    page.engine.audio.play("click");
    expect(page.stats().played).toEqual({});
    await vi.advanceTimersByTimeAsync(400);
    expect(page.ctx()?.state).toBe("suspended");
  });

  it("brings everything back when the tab is shown again", async () => {
    const page = await openUnlocked();
    page.browser.setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(400);
    page.browser.setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(page.ctx()?.state).toBe("running");
    expect(page.stats().ambienceRunning).toBe(true);
    page.engine.audio.play("click");
    expect(page.stats().played.click).toBe(1);
  });
});

describe("following the game", () => {
  it("a Doctor's save sounds the heal chime", async () => {
    const page = await openUnlocked();
    page.scene.emitFx({ kind: "save" });
    expect(page.stats().played).toEqual({ heal: 1 });
  });

  it("Safe Mode's elimination is a cartoon poof", async () => {
    const page = await openUnlocked();
    page.scene.emitFx({ kind: "eliminate", mode: "safe" });
    expect(page.stats().played).toEqual({ poof: 1 });
  });

  it("Normal Mode's elimination is a dramatic sting, and the background ducks for it", async () => {
    const page = await openUnlocked();
    page.scene.emitFx({ kind: "eliminate", mode: "normal" });
    expect(page.stats().played).toEqual({ sting: 1 });
    const events = ambienceBus(page)?.gain.events ?? [];
    expect(events.some((e) => e.method === "setTargetAtTime" && Math.abs(e.value - 0.125) < 1e-9)).toBe(true);
    // ...and comes back up afterwards
    expect(events.at(-1)).toMatchObject({ method: "setTargetAtTime", value: 0.5 });
  });

  it("the countdown ticks in the last ten seconds, and only then", async () => {
    const page = await openUnlocked();
    for (const seconds of [30, 11, 0]) page.engine.sounds.tick(seconds);
    expect(page.stats().played).toEqual({});
    for (let seconds = 10; seconds >= 1; seconds--) page.engine.sounds.tick(seconds);
    expect(page.stats().played).toEqual({ tick: 7, tickUrgent: 3 });
  });

  it("a vote makes the vote sound", async () => {
    const page = await openUnlocked();
    page.engine.sounds.vote();
    expect(page.stats().played).toEqual({ vote: 1 });
  });

  it("the end of the game plays victory or defeat music for the mode", async () => {
    const cases = [
      [true, "safe", "victorySafe"],
      [true, "normal", "victoryNormal"],
      [false, "safe", "defeatSafe"],
      [false, "normal", "defeatNormal"],
    ] as const;
    for (const [won, mode, name] of cases) {
      const page = await openUnlocked();
      page.engine.sounds.ending(won, mode);
      expect(page.stats().played, name).toEqual({ [name]: 1 });
      vi.unstubAllGlobals();
    }
  });

  it("the end music ducks the background", async () => {
    const page = await openUnlocked();
    page.engine.sounds.ending(true, "safe");
    const events = ambienceBus(page)?.gain.events ?? [];
    expect(events.some((e) => e.method === "setTargetAtTime" && e.value < 0.2)).toBe(true);
  });

  it("the sky decides the mix: night is 0, the day discussion is 1", async () => {
    const page = await openUnlocked();
    page.scene.setScene({ mode: "safe", phase: "NIGHT", winner: null });
    expect(page.stats().dayAmount).toBe(0);
    page.scene.setScene({ mode: "safe", phase: "DAY_DISCUSSION", winner: null });
    expect(page.stats().dayAmount).toBe(1);
    page.scene.setScene({ mode: "normal", phase: "NIGHT", winner: null });
    expect(page.stats().dayAmount).toBe(0);
  });
});
