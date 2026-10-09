import { useId } from "react";
import { canVibrate } from "../lib/haptics";
import { resetHints } from "../lib/hints";
import { setPrefs, usePrefs, type PersonalPrefs } from "../lib/prefs";
import { wakeLockSupported } from "../lib/wakeLock";
import { showToast } from "../state/store";

function Switch({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="switch-row">
      <span className="switch-text">
        <span>{label}</span>
        <span className="field-hint">{hint}</span>
      </span>
      <input id={id} type="checkbox" role="switch" className="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Your own choices for this device: chat language, vibration, tips and keeping the screen on. Never sent anywhere. */
export function PersonalSettings() {
  const prefs = usePrefs();
  const set = (patch: Partial<PersonalPrefs>) => setPrefs(patch);
  return (
    <fieldset className="field personal-settings">
      <legend>Just for you</legend>
      <Switch
        label="Hide strong language for me"
        hint="Hides swearing and rude words in chat on your screen, whatever the host chose."
        value={prefs.hideStrongLanguage}
        onChange={(v) => set({ hideStrongLanguage: v })}
      />
      <Switch
        label="Vibrate"
        hint={
          canVibrate()
            ? "A short buzz when a new phase starts (on every phone at once) and when you confirm a choice."
            : "This browser can't vibrate (iPhones don't allow it)."
        }
        value={prefs.haptics}
        onChange={(v) => set({ haptics: v })}
      />
      <Switch
        label="Keep the screen on during games"
        hint={wakeLockSupported() ? "Stops your phone locking in the middle of a round." : "This browser can't keep the screen on. Your phone's own auto-lock applies."}
        value={prefs.keepAwake}
        onChange={(v) => set({ keepAwake: v })}
      />
      <Switch label="Show tips" hint="Short tips the first time you see each part of the game." value={prefs.hints} onChange={(v) => set({ hints: v })} />
      <button
        type="button"
        className="btn btn-small btn-ghost"
        onClick={() => {
          resetHints();
          set({ hints: true });
          showToast("Tips will show again.");
        }}
      >
        Show all tips again
      </button>
    </fieldset>
  );
}
