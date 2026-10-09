import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ROOM_PASSWORD_MAX_LENGTH,
  validateNickname,
  type Avatar,
  type JoinRoomPayload,
  type RoomPreview,
} from "@mafia/shared";
import { Icon } from "../art/icons";
import { AvatarPicker } from "../components/AvatarPicker";
import { ErrorText } from "../components/ErrorText";
import { NicknameField } from "../components/NicknameField";
import { PhotoField } from "../components/PhotoControls";
import { randomAvatar } from "../lib/avatars";
import { friendlyError } from "../lib/errors";
import { goHome } from "../lib/router";
import { loadProfile } from "../lib/storage";
import { call } from "../net/socket";
import { joinRoom } from "../state/controller";
import { useAppState } from "../state/store";
import { NoticeBanner } from "./NoticeBanner";
import { SoundButton } from "../components/SoundControls";

type PeekState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: RoomPreview };

export function JoinScreen({ code }: { code: string }) {
  const notice = useAppState((s) => (s.notice && s.notice.roomCode === code ? s.notice : null));
  const connected = useAppState((s) => s.connection === "connected");
  const [peek, setPeek] = useState<PeekState>({ status: "loading" });

  const load = useCallback(async () => {
    const result = await call("room:peek", { roomCode: code });
    if (result.ok) setPeek({ status: "ready", preview: result.data });
    else if (result.error.code === "ROOM_NOT_FOUND") setPeek({ status: "not_found" });
    else setPeek({ status: "error", message: friendlyError(result.error) });
  }, [code]);

  useEffect(() => {
    setPeek({ status: "loading" });
    void load();
  }, [load]);

  // Refresh the preview after a reconnect (player count, stage or password may have changed).
  useEffect(() => {
    if (connected && peek.status === "error") void load();
  }, [connected]);

  return (
    <div className="screen join">
      <BackHome />
      <NoticeBanner notice={notice} />
      {peek.status === "loading" ? (
        <div className="center-block" role="status">
          <span className="spinner" aria-hidden="true" />
          Looking for room {code}…
        </div>
      ) : peek.status === "not_found" ? (
        <section className="card center-block">
          <h1 className="card-title">No room with code {code}</h1>
          <p>Check the code with your host. Rooms close after a while when nobody is in them.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => goHome()}>
            Back to Home
          </button>
        </section>
      ) : peek.status === "error" ? (
        <section className="card center-block">
          <h1 className="card-title">Couldn't reach room {code}</h1>
          <ErrorText error={peek.message} />
          <button type="button" className="btn btn-primary btn-block" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : (
        <JoinForm preview={peek.preview} onRefresh={() => void load()} />
      )}
    </div>
  );
}

function BackHome() {
  return (
    <nav className="top-nav">
      <button type="button" className="btn btn-ghost btn-small" onClick={() => goHome()}>
        <Icon name="back" />
        Home
      </button>
      <SoundButton />
    </nav>
  );
}

function JoinForm({ preview, onRefresh }: { preview: RoomPreview; onRefresh: () => void }) {
  const [profile] = useState(() => loadProfile());
  const [name, setName] = useState(profile.name ?? "");
  const [avatar, setAvatar] = useState<Avatar>(() => profile.avatar ?? randomAvatar());
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(preview.hasPassword);

  useEffect(() => {
    if (preview.hasPassword) setNeedsPassword(true);
  }, [preview.hasPassword]);

  const nameCheck = validateNickname(name);
  const spectator = preview.joinAs === "spectator";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (!nameCheck.ok) return;
    if (needsPassword && password === "") {
      setPasswordError("Enter the room's password.");
      return;
    }
    const payload: JoinRoomPayload = { roomCode: preview.roomCode, name: nameCheck.value, avatar };
    if (needsPassword) payload.password = password;
    setPending(true);
    const result = await joinRoom(payload);
    setPending(false);
    if (result.ok) return;
    const { code } = result.error;
    switch (code) {
      case "NAME_TAKEN":
        setNameError("Someone in this room already has that nickname. Try another.");
        break;
      case "INVALID_NAME":
        setNameError(result.error.message || friendlyError(result.error));
        break;
      case "WRONG_PASSWORD":
        setPasswordError("That password isn't right.");
        break;
      case "PASSWORD_REQUIRED":
        setNeedsPassword(true);
        setPasswordError("This room needs a password.");
        break;
      case "ROOM_FULL":
        setFormError("This room is full right now.");
        onRefresh();
        break;
      case "ROOM_NOT_FOUND":
        setFormError(`Room ${preview.roomCode} has closed.`);
        onRefresh();
        break;
      default:
        setFormError(friendlyError(result.error));
    }
  };

  const stageText =
    preview.stage === "lobby"
      ? "Waiting in the lobby"
      : preview.stage === "in_game"
        ? "A game is in progress"
        : "A game just finished";

  return (
    <>
      <header className="join-header">
        <p className="eyebrow">Joining room</p>
        <h1 className="room-code" aria-label={`Room ${preview.roomCode.split("").join(" ")}`}>
          {preview.roomCode}
        </h1>
        <p className="room-meta">
          {preview.hasPassword ? (
            <span className="tag">
              <Icon name="lock" size={14} />
              Private room
            </span>
          ) : null}
          <span className="tag">
            {preview.playerCount}/{preview.maxPlayers} players
          </span>
          <span className="tag">{stageText}</span>
        </p>
      </header>

      {preview.isFull ? (
        <section className="card center-block">
          <p className="card-lead">This room is full right now.</p>
          <button type="button" className="btn btn-block" onClick={onRefresh}>
            Check again
          </button>
        </section>
      ) : (
        <section className="card">
          {spectator ? (
            <p className="info-banner">
              <Icon name="eye" />A game is in progress – you'll watch and join the next round.
            </p>
          ) : null}
          <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
            <NicknameField
              id="join-name"
              value={name}
              onChange={(v) => {
                setName(v);
                setNameError(null);
              }}
              serverError={nameError}
              showValidation={submitted}
              autoFocus={name === ""}
            />
            {needsPassword ? (
              <div className="field">
                <label htmlFor="join-password">Room password</label>
                <input
                  id="join-password"
                  type="password"
                  className={`input${passwordError ? " has-error" : ""}`}
                  value={password}
                  autoComplete="off"
                  maxLength={ROOM_PASSWORD_MAX_LENGTH * 2}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby="join-password-error"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                  }}
                />
                <ErrorText id="join-password-error" error={passwordError} />
              </div>
            ) : null}
            <AvatarPicker idPrefix="join-avatar" value={avatar} onChange={setAvatar} />
            <PhotoField avatar={avatar} />
            <ErrorText error={formError} />
            <button type="submit" className="btn btn-primary btn-block btn-large" disabled={pending}>
              {pending ? "Joining…" : spectator ? "Join as spectator" : "Join game"}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
