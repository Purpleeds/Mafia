import { useState } from "react";
import { Icon } from "../art/icons";
import { setMuted, useMuted } from "../lib/prefs";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import { showToast, useAppState } from "../state/store";
import { ErrorText } from "./ErrorText";

interface PlayerMenuProps {
  playerId: string;
  name: string;
  /** The viewer is the host: make host, remove picture and kick are offered too. */
  viewerIsHost: boolean;
  /** Host can be handed only to connected players (not spectators). */
  canMakeHost: boolean;
  /** The player's own picture is showing (or waiting): the host can remove it. */
  hasPhoto: boolean;
}

/**
 * Actions for another person in the room. Everyone can mute their chat (on
 * their own screen only); the host can also hand over hosting, remove their
 * picture and remove them from the room (with a confirm step).
 */
export function PlayerMenu({ playerId, name, viewerIsHost, canMakeHost, hasPhoto }: PlayerMenuProps) {
  const roomCode = useAppState((s) => s.session?.roomCode ?? "");
  const muted = useMuted(roomCode).includes(playerId);
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

  const removePhoto = async () => {
    const result = await action.run(() => call("host:removeAvatar", { playerId }));
    if (result.ok) {
      showToast(`${name}'s picture was removed.`);
      close();
    }
  };

  const kick = async () => {
    const result = await action.run(() => call("host:kick", { playerId }));
    if (result.ok) close();
  };

  const toggleMute = () => {
    setMuted(roomCode, playerId, !muted);
    showToast(muted ? `You can see ${name}'s messages again.` : `${name}'s messages are hidden on your screen.`);
    close();
  };

  return (
    <div className="player-menu">
      <button
        type="button"
        className="btn btn-icon"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Options for ${name}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="more" size={20} />
      </button>
      {open ? (
        <div id={menuId} className="player-menu-panel">
          {confirmKick ? (
            <>
              <p className="confirm-prompt">Remove {name} from the room?</p>
              <div className="button-row">
                <button type="button" className="btn btn-danger" disabled={action.pending} onClick={() => void kick()}>
                  Yes, remove
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmKick(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="button-row">
              <button type="button" className="btn" aria-pressed={muted} onClick={toggleMute}>
                <Icon name="chatOff" />
                {muted ? "Unmute chat" : "Mute chat"}
              </button>
              {viewerIsHost && canMakeHost ? (
                <button type="button" className="btn" disabled={action.pending} onClick={() => void makeHost()}>
                  <Icon name="crown" />
                  Make host
                </button>
              ) : null}
              {viewerIsHost && hasPhoto ? (
                <button type="button" className="btn" disabled={action.pending} onClick={() => void removePhoto()}>
                  <Icon name="trash" />
                  Remove picture
                </button>
              ) : null}
              {viewerIsHost ? (
                <button type="button" className="btn btn-danger-outline" onClick={() => setConfirmKick(true)}>
                  <Icon name="userMinus" />
                  Remove from room
                </button>
              ) : null}
            </div>
          )}
          {!confirmKick ? <p className="field-hint">Muting hides their messages on your screen only.</p> : null}
          <ErrorText error={action.error} />
        </div>
      ) : null}
    </div>
  );
}
