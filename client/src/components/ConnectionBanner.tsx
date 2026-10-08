import { useEffect, useState } from "react";
import { useAppState } from "../state/store";

/** A small, non-blocking strip shown while the socket is down. */
export function ConnectionBanner() {
  const connection = useAppState((s) => s.connection);
  const hasSession = useAppState((s) => s.session !== null);
  const replaced = useAppState((s) => s.replaced !== null);
  // Don't flash "Connecting…" on a normal page load.
  const [graceOver, setGraceOver] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setGraceOver(true), 1500);
    return () => window.clearTimeout(id);
  }, []);

  const visible = !replaced && (connection === "reconnecting" || (connection === "connecting" && graceOver));
  let text = "";
  if (visible) {
    text =
      connection === "connecting"
        ? "Connecting to the server…"
        : hasSession
          ? "Reconnecting… your seat is kept for 60 seconds."
          : "Reconnecting…";
  }

  return (
    <div className={`connection-banner${visible ? " is-visible" : ""}`} role="status" aria-live="polite">
      {visible ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {text}
        </>
      ) : null}
    </div>
  );
}
