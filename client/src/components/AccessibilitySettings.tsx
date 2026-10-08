import { MOTION_OPTIONS, TEXT_SIZES, setA11y, useA11y } from "../lib/a11y";

/** Reduce motion and text size, saved on this device. Shown with the display and sound settings. */
export function AccessibilitySettings({ idPrefix }: { idPrefix: string }) {
  const prefs = useA11y();
  return (
    <div className="stack a11y-settings">
      <fieldset className="field" aria-describedby={`${idPrefix}-motion-hint`}>
        <legend>Reduce motion</legend>
        <div className="segmented">
          {MOTION_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`segment${prefs.motion === o.value ? " is-selected" : ""}`}
              aria-pressed={prefs.motion === o.value}
              onClick={() => setA11y({ motion: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p id={`${idPrefix}-motion-hint`} className="field-hint">
          On: the background stops animating (it only changes between phases), and cards, flashes and other animations
          are switched off.
        </p>
      </fieldset>
      <fieldset className="field" aria-describedby={`${idPrefix}-text-hint`}>
        <legend>Text size</legend>
        <div className="segmented">
          {TEXT_SIZES.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`segment${prefs.textSize === o.value ? " is-selected" : ""}`}
              aria-pressed={prefs.textSize === o.value}
              onClick={() => setA11y({ textSize: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p id={`${idPrefix}-text-hint`} className="field-hint">
          Makes every screen&apos;s text bigger. Your phone&apos;s own text size and zoom work too.
        </p>
      </fieldset>
    </div>
  );
}
