import { useEffect, useState } from "react";
import { useAppState } from "../state/store";

/**
 * Shown over everything while the page has never reached the server. On the
 * free hosting plan the server sleeps when nobody plays, and the first visit
 * can take up to a minute while it wakes. After the first connection it never
 * shows again (later drops use the small "Reconnecting…" strip instead).
 */
export function WakingScreen() {
  const connected = useAppState((s) => s.connection === "connected");
  const [everConnected, setEverConnected] = useState(false);
  const [waited, setWaited] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (connected) setEverConnected(true);
  }, [connected]);

  useEffect(() => {
    if (everConnected) return;
    // A normal load connects in a blink; only show the screen if it is taking a while.
    const showTimer = window.setTimeout(() => setShow(true), 1200);
    const tick = window.setInterval(() => setWaited((s) => s + 1), 1000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearInterval(tick);
    };
  }, [everConnected]);

  if (everConnected || !show) return null;
  return (
    <div className="waking-screen" role="status" aria-live="polite">
      <div className="waking-card card">
        <span className="spinner spinner-large" aria-hidden="true" />
        <h1 className="waking-title">Waking up the village…</h1>
        <p className="card-lead">The game server naps when nobody is playing. It is getting up now.</p>
        <p className="field-hint">
          {waited < 15 ? "This can take up to a minute the first time." : `Still waking up (${waited} seconds). Thanks for waiting!`}
        </p>
      </div>
    </div>
  );
}
