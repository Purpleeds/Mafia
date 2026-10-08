import { useEffect } from "react";
import { Icon } from "../art/icons";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import { preparePuter, signInFromClick, useNarratorStatus } from "../narrator/status";
import { ErrorText } from "./ErrorText";

/**
 * The host's "Enable AI Narrator" switch. Turning it on opens Puter's sign-in
 * (Puter bills AI use to the signed-in account, so only the host ever signs in;
 * nobody else needs an account). The sign-in must start from this click, so
 * Puter is loaded in the background as soon as the card appears.
 */
export function NarratorSetting({ enabled }: { enabled: boolean }) {
  const status = useNarratorStatus();
  const action = useAction();

  useEffect(() => {
    void preparePuter();
  }, []);

  const loading = status.phase === "idle" || status.phase === "loading";
  const failedToLoad = status.phase === "failed";
  const busy = action.pending || status.phase === "signing_in";

  const setEnabled = (on: boolean) => void action.run(() => call("host:updateSettings", { aiNarrator: on }));

  // Everything before the first await runs inside the click, so the sign-in popup isn't blocked.
  const turnOn = () => {
    const signedIn = signInFromClick();
    void signedIn.then((ok) => {
      if (ok) setEnabled(true);
    });
  };

  let note: string;
  if (failedToLoad) note = status.error ?? "Couldn't reach Puter. The built-in narrator will be used.";
  else if (loading) note = "Getting Puter ready…";
  else if (status.phase === "signing_in") note = "Finish signing in to Puter in the window that opened…";
  else if (enabled && status.signedIn) {
    note = `Signed in to Puter${status.username ? ` as ${status.username}` : ""}. The AI writes the news; ready-made lines are the backup.`;
  } else if (enabled) note = "The AI narrator is on, but this device isn't signed in to Puter, so ready-made lines will be used.";
  else note = status.error ?? "Off: ready-made narration is used.";

  return (
    <div className="narrator-setting">
      <label htmlFor="setting-ai-narrator" className="switch-row">
        <span className="switch-text">
          <span className="switch-label">
            <Icon name="sparkle" size={20} />
            Enable AI Narrator
          </span>
          <span className="field-hint">
            An AI writes the morning news and vote results. Only you, the host, sign in to Puter; nobody else needs an
            account. The AI is sent the names of players who left and nothing else: never anyone's role.
          </span>
        </span>
        <input
          id="setting-ai-narrator"
          type="checkbox"
          role="switch"
          className="switch"
          checked={enabled}
          disabled={loading || failedToLoad || busy}
          aria-describedby="narrator-status"
          onChange={(e) => (e.target.checked ? turnOn() : setEnabled(false))}
        />
      </label>
      <p id="narrator-status" className="field-hint" role="status">
        {note}
      </p>
      {enabled && !status.signedIn && !loading && !failedToLoad && status.phase !== "signing_in" ? (
        <button type="button" className="btn btn-small" onClick={() => void signInFromClick()}>
          Sign in to Puter
        </button>
      ) : null}
      <ErrorText error={action.error} />
    </div>
  );
}
