import { useSyncExternalStore } from "react";

/**
 * Sound preferences for this device, remembered in localStorage: the volume
 * slider, the mute button, and whether the narrator reads aloud. They live in
 * their own tiny store so the sound engine, the narrator's voice and the
 * settings screens all see the same values.
 */
export interface AudioSettings {
  /** Master volume, 0..1. */
  volume: number;
  muted: boolean;
  /** Background sounds (birds, wind, crickets, owl). */
  ambience: boolean;
  /** Clicks, votes, the countdown tick, eliminations and the end-of-game music. */
  effects: boolean;
  /** Read the narration aloud with the browser's speech synthesis. */
  voice: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  volume: 0.7,
  muted: false,
  ambience: true,
  effects: true,
  voice: false,
};

export const AUDIO_STORAGE_KEY = "mafia.audio";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Reads whatever was saved, ignoring anything that isn't the right type. */
export function parseAudioSettings(raw: string | null): AudioSettings {
  const settings = { ...DEFAULT_AUDIO_SETTINGS };
  if (!raw) return settings;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return settings;
    const v = data as Record<string, unknown>;
    if (typeof v.volume === "number" && Number.isFinite(v.volume)) settings.volume = clamp01(v.volume);
    if (typeof v.muted === "boolean") settings.muted = v.muted;
    if (typeof v.ambience === "boolean") settings.ambience = v.ambience;
    if (typeof v.effects === "boolean") settings.effects = v.effects;
    if (typeof v.voice === "boolean") settings.voice = v.voice;
  } catch {
    // Corrupt data: start from the defaults.
  }
  return settings;
}

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(AUDIO_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string): void {
  try {
    window.localStorage.setItem(AUDIO_STORAGE_KEY, value);
  } catch {
    // Storage is blocked: the choice lasts until the page closes.
  }
}

let current: AudioSettings = typeof window === "undefined" ? { ...DEFAULT_AUDIO_SETTINGS } : parseAudioSettings(readStorage());
const listeners = new Set<() => void>();

export function getAudioSettings(): AudioSettings {
  return current;
}

/** Changes some settings, saves them and tells everyone listening. */
export function setAudioSettings(patch: Partial<AudioSettings>): void {
  const next: AudioSettings = {
    ...current,
    ...patch,
    volume: clamp01(patch.volume ?? current.volume),
  };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  writeStorage(JSON.stringify(next));
  for (const listener of listeners) listener();
}

export function subscribeAudioSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(subscribeAudioSettings, getAudioSettings, getAudioSettings);
}

/** What the speakers should actually be set to: silent when muted. */
export function effectiveVolume(settings: AudioSettings): number {
  return settings.muted ? 0 : settings.volume;
}

/** Test hook: re-read the saved values (after changing localStorage). */
export function reloadAudioSettings(): void {
  current = parseAudioSettings(readStorage());
  for (const listener of listeners) listener();
}
