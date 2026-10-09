import { useId } from "react";
import { Icon } from "../art/icons";
import { setPrefs, usePrefs } from "../lib/prefs";

/** Shown in the lobby and above the chat when the host chose uncensored chat, so nobody is surprised. */
export function UncensoredNotice({ lobby }: { lobby?: boolean }) {
  return (
    <p className="uncensored-notice" role="note">
      <Icon name="warn" size={16} />
      <span>
        <strong>Uncensored chat:</strong>{" "}
        {lobby ? "the host turned the chat filter off, so strong language won't be hidden in this game." : "strong language isn't hidden."}{" "}
        Turn on &ldquo;Hide strong language for me&rdquo; to hide it on your screen. Links are always blocked.
      </span>
    </p>
  );
}

/** "Hide strong language for me": filters chat on this screen only, whatever the host chose. Saved on this device. */
export function ChatFilterToggle() {
  const prefs = usePrefs();
  const id = useId();
  return (
    <label htmlFor={id} className="switch-row switch-row-compact">
      <span className="switch-text">
        <span>Hide strong language for me</span>
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={prefs.hideStrongLanguage}
        onChange={(e) => setPrefs({ hideStrongLanguage: e.target.checked })}
      />
    </label>
  );
}
