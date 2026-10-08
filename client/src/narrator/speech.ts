import type { ContentMode } from "@mafia/shared";
import { getAudioSettings, subscribeAudioSettings } from "../audio/settings";

/** Reading the narration aloud with the browser's built-in speech synthesis (a setting, off by default). */
export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function stopSpeaking(): void {
  try {
    if (speechSupported()) window.speechSynthesis.cancel();
  } catch {
    // nothing to stop
  }
}

function englishVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => v.lang.toLowerCase().startsWith("en") && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith("en")) ?? null;
  } catch {
    return null;
  }
}

/** Reads `text` aloud if the narrator's voice is switched on and sound isn't muted. A friendly voice for Safe Mode, a gravelly one for Normal. */
export function speakNarration(text: string, mode: ContentMode): void {
  const settings = getAudioSettings();
  if (!speechSupported() || !settings.voice || settings.muted || settings.volume <= 0) return;
  try {
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = settings.volume;
    utterance.rate = mode === "normal" ? 0.92 : 1.04;
    utterance.pitch = mode === "normal" ? 0.8 : 1.2;
    const voice = englishVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-US";
    window.speechSynthesis.speak(utterance);
  } catch {
    // Speech is a nicety: never let it break the game.
  }
}

/** Stops the speech the moment the voice is turned off or sound is muted. */
export function watchSpeechSettings(): () => void {
  return subscribeAudioSettings(() => {
    const s = getAudioSettings();
    if (!s.voice || s.muted || s.volume <= 0) stopSpeaking();
  });
}
