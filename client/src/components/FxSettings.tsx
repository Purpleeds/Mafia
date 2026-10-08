import { FX_PREFERENCES, setFxPreference, useFxState, type FxPreference, type FxState, type FxTier } from "../fx/quality";

const LABEL: Record<FxPreference, string> = { auto: "Auto", full: "Full", lite: "Lite", off: "Off" };

const TIER_NAME: Record<FxTier, string> = {
  high: "full effects",
  medium: "standard effects",
  low: "lite effects",
  static: "a still picture",
};

function describe(fx: FxState): string {
  if (fx.preference === "full") return "Every effect at full quality. Uses the most battery.";
  if (fx.preference === "lite") return "A simpler, lighter animation that's kinder to older phones.";
  if (fx.preference === "off") return "A still picture of the village. Saves the most battery.";
  if (!fx.auto) return "Checking what this device can handle…";
  if (fx.slowedDown) return `Auto switched to ${TIER_NAME[fx.tier]} because the animation was running slowly.`;
  return `Auto picked ${TIER_NAME[fx.auto.tier]} for ${fx.auto.reason}.`;
}

/** Background quality: Auto, Full, Lite or Off. Saved on this device only. */
export function FxSettings({ idPrefix }: { idPrefix: string }) {
  const fx = useFxState();
  const hintId = `${idPrefix}-hint`;
  return (
    <fieldset className="field fx-settings" aria-describedby={hintId}>
      <legend>Background effects</legend>
      <div className="segmented">
        {FX_PREFERENCES.map((preference) => (
          <button
            key={preference}
            type="button"
            className={`segment${fx.preference === preference ? " is-selected" : ""}`}
            aria-pressed={fx.preference === preference}
            onClick={() => setFxPreference(preference)}
          >
            {LABEL[preference]}
          </button>
        ))}
      </div>
      <p id={hintId} className="field-hint">
        {describe(fx)}
        {fx.reducedMotion && fx.tier !== "static"
          ? " Your device asks for less motion, so the scene only changes between phases."
          : ""}
      </p>
    </fieldset>
  );
}
