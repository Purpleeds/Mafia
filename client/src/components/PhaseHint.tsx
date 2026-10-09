import { Icon } from "../art/icons";
import { HINTS, markHintSeen, type HintId, useHintsSeen } from "../lib/hints";
import { setPrefs, usePrefs } from "../lib/prefs";

/** A one-time tip explaining this phase. "Got it" hides it for good; "Turn off tips" hides them all. */
export function PhaseHint({ id }: { id: HintId }) {
  const prefs = usePrefs();
  const seen = useHintsSeen();
  if (!prefs.hints || seen.includes(id)) return null;
  const hint = HINTS[id];
  return (
    <aside className="hint" aria-label={`Tip: ${hint.title}`}>
      <Icon name="bulb" size={18} className="hint-icon" />
      <div className="hint-body">
        <p className="hint-title">{hint.title}</p>
        <p className="hint-text">{hint.text}</p>
        <div className="hint-actions">
          <button type="button" className="btn btn-small" onClick={() => markHintSeen(id)}>
            Got it
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setPrefs({ hints: false })}>
            Turn off tips
          </button>
        </div>
      </div>
    </aside>
  );
}
