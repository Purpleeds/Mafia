import { NARRATION_TIMEOUT_MS, SKIP, defaultSettings, effectiveChatFilter, gangName } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { findBannedWord } from "@mafia/shared";
import { nextWake } from "./narrate.js";
import { Game, R7, gameWithRoles, lobby, runNight, runVote } from "./testing/harness.js";
import { getGameView } from "./view.js";

const AI = { aiNarrator: true };

/** A game at the morning news after a night in which p1 (Mafia) picked p4, with the AI narrator on. */
function morningWithAi(settings = {}) {
  const g = gameWithRoles(R7, { settings: { ...AI, ...settings } });
  runNight(g, [["p1", "p4"]]);
  return g;
}

describe("the narrator, with the AI off", () => {
  it("writes the morning news at once from the ready-made lines", () => {
    const g = gameWithRoles(R7);
    runNight(g, [["p1", "p4"]]);
    expect(g.phase).toBe("NIGHT_RESULTS");
    const n = g.state.narration;
    expect(n).toMatchObject({ kind: "night", round: 1, status: "ready", source: "template", fallback: "ai_off" });
    expect(n?.text).toContain("Player 4");
  });

  it("writes the vote result too, naming who went", () => {
    const g = gameWithRoles(R7);
    runNight(g, []);
    g.advanceTo("VOTING");
    runVote(g, { p1: "p4", p2: "p4", p3: "p4", p5: "p4" });
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(g.state.narration).toMatchObject({ kind: "vote", status: "ready", source: "template" });
    expect(g.state.narration?.text).toContain("Player 4");
  });

  it("says something for quiet nights, saves, skips and ties", () => {
    const quiet = gameWithRoles(R7);
    runNight(quiet, []);
    expect(quiet.state.narration?.text).toBeTruthy();
    const saved = gameWithRoles(R7);
    runNight(saved, [
      ["p1", "p4"],
      ["p2", "p4"],
    ]);
    expect(saved.state.narration?.text).toMatch(/doctor|helper/i);
    const skipped = gameWithRoles(R7);
    runNight(skipped, []);
    skipped.advanceTo("VOTING");
    runVote(skipped, { p1: SKIP, p2: SKIP, p3: SKIP, p4: SKIP, p5: SKIP, p6: SKIP, p7: SKIP });
    expect(skipped.state.narration?.text).toBeTruthy();
  });

  it("never repeats a ready-made line within a game", () => {
    const g = gameWithRoles(R7);
    const lines: string[] = [];
    for (let night = 1; night <= 6; night++) {
      runNight(g, []);
      lines.push(g.state.narration?.text ?? "");
      g.advanceTo("VOTING");
      runVote(g, {});
      if (g.phase !== "VOTE_RESULTS") g.endPhase();
      lines.push(g.state.narration?.text ?? "");
      g.endPhase();
    }
    expect(new Set(lines).size).toBe(lines.length);
    expect(g.state.usedTemplates.length).toBe(lines.length);
  });

  it("starts a new game with fresh lines, and clears the announcement", () => {
    const g = gameWithRoles(R7);
    runNight(g, []);
    expect(g.state.usedTemplates.length).toBe(1);
    g.endPhase(); // -> day
    g.advanceTo("VOTING");
    g.endPhase();
    g.endPhase(); // -> night 2
    expect(g.phase).toBe("NIGHT");
    expect(g.state.narration).toBeNull(); // cleared when a new night starts
    g.state.phase = "GAME_OVER";
    g.state.winner = "town";
    g.ok({ type: "RESTART", playerId: "p1" });
    expect(g.state.usedTemplates).toEqual([]);
    expect(g.state.narration).toBeNull();
  });
});

describe("the AI narrator", () => {
  it("makes the morning news wait for the host's browser", () => {
    const g = morningWithAi();
    expect(g.phase).toBe("NIGHT_RESULTS");
    expect(g.state.narration).toMatchObject({ kind: "night", status: "pending", text: null, source: null });
    expect(g.state.narration?.deadline).toBe(g.now + NARRATION_TIMEOUT_MS);
  });

  it("shows an AI narration that passes the checks, as written", () => {
    const g = morningWithAi();
    g.ok({ type: "NARRATE", candidate: '"A hush fell over the town. By dawn, Player 4 was gone."' });
    expect(g.state.narration).toMatchObject({
      status: "ready",
      source: "ai",
      fallback: null,
      text: "A hush fell over the town. By dawn, Player 4 was gone.",
    });
  });

  it("falls back to a ready-made line when the AI's text fails the checks", () => {
    const rejects: Array<[string, string]> = [
      ["Player 4 was killed in the night.", "rejected_banned_word"], // Safe Mode: no violence words
      ["Somebody vanished in the night.", "rejected_missing_name"],
      ["Player 4 was sent home. ".repeat(30), "rejected_too_long"],
      ["Player 4 was sent home. The detective sighed.", "rejected_reveals_role"],
      ["Player 4 was sent home. Keep an eye on Player 2.", "rejected_mentions_other_player"],
    ];
    for (const [text, why] of rejects) {
      const g = morningWithAi();
      g.ok({ type: "NARRATE", candidate: text });
      expect(g.state.narration, text).toMatchObject({ status: "ready", source: "template", fallback: why });
      expect(g.state.narration?.text).toContain("Player 4");
    }
  });

  it("holds Normal Mode to its own rules: noir is fine, gore is not", () => {
    const noir = morningWithAi({ contentMode: "normal" });
    noir.ok({ type: "NARRATE", candidate: "A shot rang out. By morning, Player 4 was found at the docks." });
    expect(noir.state.narration).toMatchObject({ source: "ai" });
    const gore = morningWithAi({ contentMode: "normal" });
    gore.ok({ type: "NARRATE", candidate: "Player 4 was dismembered at the docks." });
    expect(gore.state.narration).toMatchObject({ source: "template", fallback: "rejected_banned_word" });
  });

  it("uses a ready-made line when the AI failed (null), and says why", () => {
    const g = morningWithAi();
    g.ok({ type: "NARRATE", candidate: null, reason: "ai_failed" });
    expect(g.state.narration).toMatchObject({ status: "ready", source: "template", fallback: "ai_failed" });
    const away = morningWithAi();
    away.ok({ type: "NARRATE", candidate: null, reason: "host_away" });
    expect(away.state.narration).toMatchObject({ fallback: "host_away" });
  });

  it("falls back after 6 seconds if the host's browser never answers (timeout)", () => {
    const g = morningWithAi();
    const started = g.now;
    g.now = started + NARRATION_TIMEOUT_MS - 1;
    g.ok({ type: "TICK" });
    expect(g.state.narration?.status).toBe("pending");
    g.now = started + NARRATION_TIMEOUT_MS;
    g.ok({ type: "TICK" });
    expect(g.state.narration).toMatchObject({ status: "ready", source: "template", fallback: "timeout" });
    expect(g.state.narration?.text).toContain("Player 4");
  });

  it("keeps the results screen up until the narrator has spoken, then leaves time to read", () => {
    const g = morningWithAi({ timers: { nightResultsSeconds: 3 } });
    expect(g.state.phaseEndsAt).toBe(g.now + 3000);
    // the phase timer runs out while the AI is still thinking: the phase must not move on
    g.now += 4000;
    g.ok({ type: "TICK" });
    expect(g.phase).toBe("NIGHT_RESULTS");
    expect(g.state.narration?.status).toBe("pending");
    // the narrator's deadline passes: a ready-made line, and at least 5 s to read it
    g.now += 2500;
    g.ok({ type: "TICK" });
    expect(g.phase).toBe("NIGHT_RESULTS");
    expect(g.state.narration?.status).toBe("ready");
    expect(g.state.phaseEndsAt).toBe(g.now + 5000);
    g.now += 5000;
    g.ok({ type: "TICK" });
    expect(g.phase).toBe("DAY_DISCUSSION");
    // the morning news stays available as the day's recap
    expect(g.state.narration).toMatchObject({ kind: "night", status: "ready" });
  });

  it("also waits for the narrator after a vote", () => {
    const g = gameWithRoles(R7, { settings: AI });
    runNight(g, []);
    g.ok({ type: "NARRATE", candidate: null });
    g.advanceTo("VOTING");
    runVote(g, { p1: "p4", p2: "p4", p3: "p4", p5: "p4" });
    expect(g.phase).toBe("VOTE_RESULTS");
    expect(g.state.narration).toMatchObject({ kind: "vote", status: "pending" });
    g.ok({ type: "NARRATE", candidate: "The town has spoken: Player 4 is out." });
    expect(g.state.narration).toMatchObject({ kind: "vote", source: "ai" });
  });

  it("refuses an answer when nothing is waiting", () => {
    const g = gameWithRoles(R7, { settings: AI });
    expect(g.fail({ type: "NARRATE", candidate: "Hello" })).toBe("WRONG_PHASE");
    runNight(g, []);
    g.ok({ type: "NARRATE", candidate: null });
    expect(g.fail({ type: "NARRATE", candidate: "Again" })).toBe("WRONG_PHASE"); // already settled
  });

  it("wakes the timer at the narrator's deadline, never in the past", () => {
    const g = morningWithAi({ timers: { nightResultsSeconds: 3 } });
    expect(nextWake(g.state)).toBe(g.state.narration?.deadline);
    g.now += 10_000;
    g.ok({ type: "NARRATE", candidate: null });
    expect(nextWake(g.state)).toBe(g.state.phaseEndsAt);
    expect(nextWake(g.state) ?? 0).toBeGreaterThan(g.now);
  });

  it("is dropped if the game ends while it is pending (the host removes the last Mafia)", () => {
    // p2 is the Mafia this time, so the host (p1) can remove them
    const g = gameWithRoles(["doctor", "mafia", "detective", "villager", "villager", "villager", "villager"], {
      settings: AI,
    });
    runNight(g, [["p2", "p4"]]);
    expect(g.state.narration?.status).toBe("pending");
    g.ok({ type: "KICK", playerId: "p1", targetId: "p2" });
    expect(g.phase).toBe("GAME_OVER");
    expect(g.state.narration).toBeNull();
    expect(g.state.winner).toBe("town");
  });
});

describe("what the players are told", () => {
  it("shows a thinking narrator, then the text; never the deadline, id or fallback", () => {
    const g = morningWithAi();
    const thinking = getGameView(g.state, "p5").narration;
    expect(thinking).toEqual({ kind: "night", round: 1, status: "thinking", text: null, source: null });
    g.ok({ type: "NARRATE", candidate: "Player 4 was whisked away by the Mafia." });
    const ready = getGameView(g.state, "p5").narration;
    expect(ready).toEqual({ kind: "night", round: 1, status: "ready", text: "Player 4 was whisked away by the Mafia.", source: "ai" });
    const json = JSON.stringify(getGameView(g.state, "p5"));
    expect(json).not.toContain("deadline");
    expect(json).not.toContain("fallback");
    expect(json).not.toContain(g.state.narration?.id ?? "no-id");
  });

  it("is the same for everyone, including spectators", () => {
    const g = gameWithRoles(R7);
    runNight(g, [["p1", "p4"]]);
    g.ok({ type: "JOIN", playerId: "late", name: "Late One", avatar: { color: "teal", seed: "fox" } });
    const views = ["p1", "p2", "p4", "p7", "late"].map((id) => getGameView(g.state, id).narration);
    for (const v of views) expect(v).toEqual(views[0]);
    expect(views[0]?.text).toBeTruthy();
  });
});

describe("content modes", () => {
  it("can't be changed once the game has started", () => {
    const g = gameWithRoles(R7);
    for (const phase of ["NIGHT", "NIGHT_RESULTS", "DAY_DISCUSSION", "VOTING", "VOTE_RESULTS", "GAME_OVER", "ROLE_REVEAL"] as const) {
      g.state.phase = phase;
      expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "normal" } }), phase).toBe("WRONG_PHASE");
      expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { sneakyGang: true } }), phase).toBe("WRONG_PHASE");
      expect(g.state.settings.contentMode).toBe("safe");
    }
  });

  it("starts in Safe Mode, and only the host picks", () => {
    const g = lobby(5);
    expect(g.state.settings.contentMode).toBe("safe");
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p2", settings: { contentMode: "normal" } })).toBe("NOT_HOST");
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "normal" } });
    expect(g.state.settings.contentMode).toBe("normal");
  });

  it("always filters chat strictly in Safe Mode; Normal Mode lets the host choose (standard by default)", () => {
    const g = lobby(5);
    expect(defaultSettings()).toMatchObject({ chatFilter: "strict", customAvatars: "approval", sneakyGang: false, aiNarrator: false });
    expect(effectiveChatFilter(g.state.settings)).toBe("strict");
    // the host can't loosen it in Safe Mode, in any combination...
    for (const chatFilter of ["standard", "uncensored"] as const) {
      expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { chatFilter } }), chatFilter).toBe("INVALID_SETTINGS");
      expect(
        g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "safe", chatFilter } }),
        chatFilter,
      ).toBe("INVALID_SETTINGS");
    }
    expect(g.state.settings.chatFilter).toBe("strict");
    // ...Normal Mode starts on standard, and the host may pick any level, in one patch or two
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "normal" } });
    expect(g.state.settings).toMatchObject({ chatFilter: "standard", customAvatars: "on" });
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { chatFilter: "uncensored" } });
    expect(effectiveChatFilter(g.state.settings)).toBe("uncensored");
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { chatFilter: "strict" } });
    expect(effectiveChatFilter(g.state.settings)).toBe("strict");
    // going back to Safe Mode makes it strict again, for good
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { chatFilter: "uncensored" } });
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "safe" } });
    expect(g.state.settings).toMatchObject({ chatFilter: "strict", customAvatars: "approval" });
    // one patch that switches to Normal Mode and Uncensored at once is fine
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "normal", chatFilter: "uncensored" } });
    expect(g.state.settings.chatFilter).toBe("uncensored");
    for (const bad of ["no", true, "UNCENSORED", null]) {
      expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { chatFilter: bad } })).toBe("INVALID_SETTINGS");
    }
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { profanityFilter: false } })).toBe("INVALID_SETTINGS");
  });

  it("keeps the host's picture setting when it is set in the same change as the mode", () => {
    const g = lobby(5);
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "normal", customAvatars: "off" } });
    expect(g.state.settings.customAvatars).toBe("off");
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { customAvatars: "approval" } });
    expect(g.state.settings.customAvatars).toBe("approval");
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { customAvatars: "maybe" } })).toBe("INVALID_SETTINGS");
  });

  it("renames the Mafia in Safe Mode only", () => {
    const g = lobby(5);
    expect(gangName(g.state.settings)).toBe("Mafia");
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { sneakyGang: true } });
    expect(gangName(g.state.settings)).toBe("Sneaky Gang");
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { contentMode: "normal" } });
    expect(g.state.settings.sneakyGang).toBe(true); // remembered, but not used
    expect(gangName(g.state.settings)).toBe("Mafia");
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { sneakyGang: 1 } })).toBe("INVALID_SETTINGS");
  });

  it("names the Sneaky Gang in the ready-made lines when the host picked it", () => {
    const g = gameWithRoles(R7, { settings: { sneakyGang: true } });
    const texts = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) {
      const h = gameWithRoles(R7, { seed, settings: { sneakyGang: true } });
      runNight(h, [["p1", "p4"]]);
      texts.add(h.state.narration?.text ?? "");
    }
    const joined = [...texts].join(" ");
    expect(joined).toContain("Sneaky Gang");
    expect(joined).not.toContain("Mafia");
    expect(findBannedWord(joined, "safe")).toBeNull();
    void g;
  });

  it("toggles the AI narrator in the lobby like any setting", () => {
    const g = lobby(5);
    g.ok({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { aiNarrator: true } });
    expect(g.state.settings.aiNarrator).toBe(true);
    expect(g.fail({ type: "UPDATE_SETTINGS", playerId: "p1", settings: { aiNarrator: "yes" } })).toBe("INVALID_SETTINGS");
  });
});
