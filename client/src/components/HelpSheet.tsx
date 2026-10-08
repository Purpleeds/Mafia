import { useEffect, useRef, useState } from "react";
import type { ContentMode } from "@mafia/shared";
import { FxSettings } from "./FxSettings";
import { HowToPlayContent, RoleGuideContent } from "./RulesContent";

/** "How to play" and the role guide in a dialog, so you never leave the game to read them. */
export function HelpSheet({ mode, onClose }: { mode: ContentMode; onClose: () => void }) {
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
            Display
          </button>
        </div>
        <div className="sheet-body">
          {tab === "how" ? (
            <HowToPlayContent />
          ) : tab === "roles" ? (
            <RoleGuideContent initialMode={mode} />
          ) : (
            <FxSettings idPrefix="sheet-fx" />
          )}
        </div>
      </div>
    </div>
  );
}
