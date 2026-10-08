import { useState } from "react";
import { joinUrl } from "@mafia/shared";
import { Icon } from "../art/icons";
import { showToast } from "../state/store";
import { QrCode } from "./QrCode";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The join link with Copy / Share buttons and a QR code for people in the same room. */
export function InviteCard({ code, hasPassword }: { code: string; hasPassword: boolean }) {
  const url = joinUrl(window.location.origin, code);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === "function";

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      showToast("Couldn't copy. Select the link and copy it by hand.");
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: "Join my Mafia game", text: `Join my Mafia game! Room code ${code}`, url });
    } catch {
      // Cancelled by the user, or not allowed: nothing to do.
    }
  };

  return (
    <section className="card invite" aria-labelledby="invite-title">
      <h2 id="invite-title" className="card-title">
        Invite players
      </h2>
      <QrCode text={url} alt={`QR code that opens the join link for room ${code}`} />
      <p className="invite-hint">Scan with a phone camera to join{hasPassword ? " (they'll need the password)" : ""}.</p>
      <div className="link-box">
        <input
          className="input input-link"
          value={url}
          readOnly
          aria-label="Join link"
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
      <div className="button-row">
        <button type="button" className="btn" onClick={() => void copy()}>
          <Icon name={copied ? "check" : "copy"} />
          {copied ? "Copied!" : "Copy link"}
        </button>
        {canShare ? (
          <button type="button" className="btn" onClick={() => void share()}>
            <Icon name="share" />
            Share
          </button>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copied" : ""}
      </span>
    </section>
  );
}
