import { useState } from "react";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import { showToast } from "../state/store";
import { ErrorText } from "./ErrorText";

interface PlayerMenuProps {
  playerId: string;
  name: string;
  /** Host can be handed only to players (not spectators). */
  canMakeHost: boolean;
}

/** The host's per-player actions: make host, kick (with a confirm step). */
export function PlayerMenu({ playerId, name, canMakeHost }: PlayerMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmKick, setConfirmKick] = useState(false);
  const action = useAction();
  const menuId = `player-menu-${playerId}`;

  const close = () => {
    setOpen(false);
    setConfirmKick(false);
    action.clearError();
  };

  const makeHost = async () => {
    const result = await action.run(() => call("host:transfer", { playerId }));
    if (result.ok) {
      showToast(`${name} is now the host.`);
      close();
    }
  };

  const kick = async () => {
    const result = await action.run(() => call("host:kick", { playerId }));
    if (result.ok) {
      showToast(`${name} was removed.`);
      close();
    }
  };

  return (
    <div className="player-menu">
      <button
        type="button"
        className="btn btn-icon"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Host actions for ${name}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div id={menuId} className="player-menu-panel">
          {confirmKick ? (
            <>
              <p className="confirm-prompt">Kick {name} from the room?</p>
              <div className="button-row">
                <button type="button" className="btn btn-danger" disabled={action.pending} onClick={() => void kick()}>
                  Yes, kick
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmKick(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="button-row">
              {canMakeHost ? (
                <button type="button" className="btn" disabled={action.pending} onClick={() => void makeHost()}>
                  <span aria-hidden="true">👑 </span>Make host
                </button>
              ) : null}
              <button type="button" className="btn btn-danger-outline" onClick={() => setConfirmKick(true)}>
                Kick
              </button>
            </div>
          )}
          <ErrorText error={action.error} />
        </div>
      ) : null}
    </div>
  );
}
