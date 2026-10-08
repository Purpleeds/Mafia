import { useEffect, useRef } from "react";
import { Icon } from "../art/icons";
import { takeOverSession } from "../state/controller";
import { useAppState } from "../state/store";

/** Full-screen notice when the same seat is opened in another tab or on another device. */
export function ReplacedOverlay() {
  const replaced = useAppState((s) => s.replaced);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (replaced) buttonRef.current?.focus();
  }, [replaced]);

  if (!replaced) return null;
  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="replaced-title" aria-describedby="replaced-text">
      <div className="overlay-card">
        <div className="overlay-icon">
          <Icon name="phone" size={48} />
        </div>
        <h2 id="replaced-title">This game is open on another tab or device</h2>
        <p id="replaced-text">{replaced} You can only play from one place at a time.</p>
        <button ref={buttonRef} type="button" className="btn btn-primary btn-block" onClick={takeOverSession}>
          Play here
        </button>
      </div>
    </div>
  );
}
