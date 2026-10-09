import { useId, useState } from "react";
import type { AvatarView, GameView, SessionInfo } from "@mafia/shared";
import { Icon } from "../art/icons";
import { friendlyError } from "../lib/errors";
import { savePhoto, uploadPhoto, useSavedPhoto } from "../lib/photo";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import { showToast, useAppState } from "../state/store";
import { AvatarBadge } from "./AvatarBadge";
import { ErrorText } from "./ErrorText";
import { PhotoCropDialog } from "./PhotoCropDialog";

/**
 * Before joining (home and join screens): pick, crop and keep a picture on this
 * device. It is sent to the room once you're in, if the host allows pictures.
 */
export function PhotoField({ avatar }: { avatar: AvatarView }) {
  const saved = useSavedPhoto();
  const [cropping, setCropping] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const switchId = useId();

  const keep = (dataUrl: string) => {
    setCropping(false);
    setNote(savePhoto({ dataUrl, use: true }) ? null : "Your browser wouldn't save the picture, so it only lasts for this visit.");
  };

  return (
    <fieldset className="photo-field">
      <legend>Your own picture (optional)</legend>
      {saved ? (
        <>
          <div className="photo-row">
            <AvatarBadge avatar={avatar} previewUrl={saved.use ? saved.dataUrl : null} size={56} />
            <label htmlFor={switchId} className="switch-row photo-use">
              <span className="switch-text">
                <span>Use my picture</span>
                <span className="field-hint">Off: your drawn avatar is used.</span>
              </span>
              <input
                id={switchId}
                type="checkbox"
                role="switch"
                className="switch"
                checked={saved.use}
                onChange={(e) => savePhoto({ ...saved, use: e.target.checked })}
              />
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="btn btn-small" onClick={() => setCropping(true)}>
              <Icon name="image" size={16} />
              Change picture
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => savePhoto(null)}>
              <Icon name="trash" size={16} />
              Forget it
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn-block" onClick={() => setCropping(true)}>
          <Icon name="image" />
          Add your own picture
        </button>
      )}
      <p className="field-hint">
        Used when the host allows pictures (some hosts approve each one first). Kept on this device for your next game.
      </p>
      {note ? <p className="field-hint">{note}</p> : null}
      {cropping ? <PhotoCropDialog onDone={keep} onClose={() => setCropping(false)} /> : null}
    </fieldset>
  );
}

/** In the lobby: your picture's state in this room, and changing or removing it. */
export function RoomPhotoControls({ view }: { view: GameView }) {
  const session = useAppState((s) => s.session);
  const saved = useSavedPhoto();
  const [cropping, setCropping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useAction();
  const you = view.you;
  if (!you || !session) return null;
  const policy = view.settings.customAvatars;

  const send = async (s: SessionInfo, dataUrl: string) => {
    setUploading(true);
    setError(null);
    const result = await uploadPhoto(s, dataUrl);
    setUploading(false);
    if (!result.ok) setError(result.message);
    else showToast(result.status === "pending" ? "Sent. The host will approve it before others see it." : "Your picture is showing.");
  };

  const choose = (dataUrl: string) => {
    setCropping(false);
    savePhoto({ dataUrl, use: true });
    void send(session, dataUrl);
  };

  const useDrawn = async () => {
    const result = await remove.run(() => call("player:removeAvatar", {}));
    if (result.ok && saved) savePhoto({ ...saved, use: false });
  };

  if (policy === "off") {
    return <p className="field-hint">The host has turned off players&apos; own pictures in this room.</p>;
  }

  return (
    <div className="photo-controls stack">
      {you.photo ? (
        <p className="field-hint" role="status">
          {you.photo.status === "pending" ? (
            <>
              <Icon name="clock" size={15} /> Your picture is waiting for the host to approve it. Until then everyone sees
              your drawn avatar.
            </>
          ) : (
            <>
              <Icon name="check" size={15} /> Your picture is showing.
            </>
          )}
        </p>
      ) : null}
      <div className="button-row">
        {you.photo || !saved ? (
          <button type="button" className="btn btn-small" disabled={uploading} onClick={() => setCropping(true)}>
            <Icon name="image" size={16} />
            {uploading ? "Sending…" : you.photo ? "Change picture" : "Use my own picture"}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-small" disabled={uploading} onClick={() => void send(session, saved.dataUrl)}>
              <AvatarBadge avatar={you.avatar} previewUrl={saved.dataUrl} size={22} />
              {uploading ? "Sending…" : "Use my saved picture"}
            </button>
            <button type="button" className="btn btn-small btn-ghost" disabled={uploading} onClick={() => setCropping(true)}>
              Pick a new one
            </button>
          </>
        )}
        {you.photo ? (
          <button type="button" className="btn btn-small btn-ghost" disabled={remove.pending} onClick={() => void useDrawn()}>
            Use my drawn avatar
          </button>
        ) : null}
      </div>
      <ErrorText error={error ?? remove.error} />
      {cropping ? <PhotoCropDialog onDone={choose} onClose={() => setCropping(false)} /> : null}
    </div>
  );
}

/** Host only, in the lobby: pictures waiting for approval. Nobody else sees them until you approve. */
export function AvatarRequests({ view }: { view: GameView }) {
  const images = useAppState((s) => s.avatarImages);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (view.avatarRequests.length === 0) return null;

  const review = async (playerId: string, approve: boolean) => {
    setBusy(playerId);
    const result = await call("host:reviewAvatar", { playerId, approve });
    setBusy(null);
    setError(result.ok ? null : friendlyError(result.error));
  };

  return (
    <section className="card card-highlight" aria-labelledby="requests-title">
      <h2 id="requests-title" className="card-title">
        Pictures to approve
      </h2>
      <p className="field-hint">Only you can see these. Approve a picture to show it to everyone.</p>
      <ul className="request-list">
        {view.avatarRequests.map((r) => {
          const player = view.players.find((p) => p.id === r.playerId) ?? view.spectators.find((s) => s.id === r.playerId);
          const name = player?.name ?? "Someone";
          const url = images[r.photo];
          return (
            <li key={r.playerId} className="request-row">
              {url ? (
                <img className="request-photo" src={url} alt={`${name}'s picture`} width={72} height={72} />
              ) : (
                <span className="request-photo request-loading" role="status">
                  <span className="spinner" aria-hidden="true" />
                  <span className="sr-only">Loading {name}&apos;s picture</span>
                </span>
              )}
              <span className="request-name">{name}</span>
              <span className="button-row">
                <button type="button" className="btn btn-primary btn-small" disabled={busy !== null} onClick={() => void review(r.playerId, true)}>
                  <Icon name="check" size={16} />
                  Approve
                </button>
                <button type="button" className="btn btn-danger-outline btn-small" disabled={busy !== null} onClick={() => void review(r.playerId, false)}>
                  <Icon name="close" size={16} />
                  Reject
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <ErrorText error={error} />
    </section>
  );
}
