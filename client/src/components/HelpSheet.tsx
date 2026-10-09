import { useEffect, useRef, useState } from "react";
import type { WordingSettings } from "../lib/wording";
import { AccessibilitySettings } from "./AccessibilitySettings";
import { FxSettings } from "./FxSettings";
import { PersonalSettings } from "./PersonalSettings";
import { SoundPanel } from "./SoundControls";
import { HowToPlayContent, RoleGuideContent } from "./RulesContent";

/** "How to play" and the role guide in a dialog, so you never leave the game to read them. */
export function HelpSheet({ settings, onClose }: { settings: WordingSettings; onClose: () => void }) {
  const [tab, setTab] = useState<"how" | "roles" | "display">("how");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <div className="card-header">
          <h2 id="help-title" className="card-title">
            Help
          </h2>
          <button ref={closeRef} type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="segmented" role="tablist" aria-label="Help sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "how"}
            className={`segment${tab === "how" ? " is-selected" : ""}`}
            onClick={() => setTab("how")}
          >
            How to play
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "roles"}
            className={`segment${tab === "roles" ? " is-selected" : ""}`}
            onClick={() => setTab("roles")}
          >
            Role guide
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "display"}
            className={`segment${tab === "display" ? " is-selected" : ""}`}
            onClick={() => setTab("display")}
          >
            Display, sound and access
          </button>
        </div>
        <div className="sheet-body" tabIndex={0} role="region" aria-label="Help contents">
          {tab === "how" ? (
            <HowToPlayContent settings={settings} />
          ) : tab === "roles" ? (
            <RoleGuideContent initialMode={settings.contentMode} settings={settings} lockMode />
          ) : (
            <div className="stack">
              <PersonalSettings />
              <AccessibilitySettings idPrefix="sheet-a11y" />
              <FxSettings idPrefix="sheet-fx" />
              <SoundPanel idPrefix="sheet-sound" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
