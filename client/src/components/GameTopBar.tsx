import { Icon } from "../art/icons";
import { MODE_INFO } from "../lib/copy";
import { PHASE_LABEL } from "../lib/labels";
import type { ReceivedState } from "../state/store";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { Countdown } from "./Countdown";
import { ModeBadge } from "./ModeBadge";

/** Mode badge, phase, countdown and connection status: visible on every in-game screen. */
export function GameTopBar({ received, onHelp }: { received: ReceivedState; onHelp: () => void }) {
  const { view, room, serverNow } = received.payload;
  return (
    <header className="top-bar" aria-label="Game status">
      <div className="top-bar-row">
        <ModeBadge mode={view.settings.contentMode} />
        <span className="top-bar-room" aria-label={`Room ${room.code}`}>
          {room.hasPassword ? <Icon name="lock" size={14} /> : null}
          {room.code}
        </span>
        <ConnectionIndicator />
        <button type="button" className="btn btn-small top-bar-help" onClick={onHelp} aria-label="How to play and role guide">
          <Icon name="help" size={20} />
        </button>
      </div>
      <div className="top-bar-row top-bar-phase">
        <h1 className="phase-name">{PHASE_LABEL[view.phase]}</h1>
        {view.round > 0 ? <span className="tag">Round {view.round}</span> : null}
        <Countdown endsAt={view.phaseEndsAt} serverNow={serverNow} receivedAt={received.receivedAt} />
      </div>
      <span className="sr-only">{MODE_INFO[view.settings.contentMode].blurb}</span>
    </header>
  );
}
