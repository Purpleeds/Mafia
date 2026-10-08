import { useState, type FormEvent } from "react";
import {
  CUSTOM_CODE_MAX_LENGTH,
  ROOM_PASSWORD_MAX_LENGTH,
  normalizeRoomCode,
  roomCodeFromPath,
  validateCustomRoomCode,
  validateNickname,
  validateRoomPassword,
  type Avatar,
  type CreateRoomPayload,
} from "@mafia/shared";
import { AvatarPicker } from "../components/AvatarPicker";
import { ErrorText } from "../components/ErrorText";
import { NicknameField } from "../components/NicknameField";
import { randomAvatar } from "../lib/avatars";
import { friendlyError } from "../lib/errors";
import { goToRoom } from "../lib/router";
import { loadActiveRoom, loadProfile } from "../lib/storage";
import { createRoom } from "../state/controller";
import { useAppState } from "../state/store";
import { NoticeBanner } from "./NoticeBanner";

export function HomeScreen() {
  const notice = useAppState((s) => (s.notice && s.notice.roomCode === null ? s.notice : null));
  const sessionRoom = useAppState((s) => s.session?.roomCode ?? null);
  const [savedRoom] = useState(() => loadActiveRoom());
  const returnTo = sessionRoom ?? savedRoom;

  return (
    <div className="screen home">
      <header className="home-header">
        <div className="logo" aria-hidden="true">
          🕵️
        </div>
        <h1>Mafia</h1>
        <p className="tagline">The party game of secrets and suspicion. Grab your friends and a phone each.</p>
      </header>

      <NoticeBanner notice={notice} />

      {returnTo ? (
        <section className="card card-highlight">
          <p className="card-lead">You're still in room {returnTo}.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => goToRoom(returnTo)}>
            Back to room {returnTo}
          </button>
        </section>
      ) : null}

      <JoinByCode />
      <CreateRoomCard />
    </div>
  );
}

/** Accepts a typed code, or a pasted join link ("https://site/ABCD" -> "ABCD"). */
function codeFromInput(raw: string): string {
  if (raw.includes("/")) {
    try {
      const fromLink = roomCodeFromPath(new URL(raw.trim()).pathname);
      if (fromLink) return fromLink;
    } catch {
      // not a URL: fall through
    }
  }
  return raw.toUpperCase().replace(/[^A-Z0-9 -]/g, "");
}

function JoinByCode() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      setError("Room codes are 4–8 letters or numbers, like ABCD.");
      return;
    }
    goToRoom(normalized);
  };

  return (
    <section className="card" aria-labelledby="join-title">
      <h2 id="join-title" className="card-title">
        Join a room
      </h2>
      <form onSubmit={submit} noValidate>
        <label htmlFor="join-code" className="sr-only">
          Room code
        </label>
        <input
          id="join-code"
          className="input input-code"
          value={code}
          placeholder="ABCD"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-describedby="join-code-error"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setCode(codeFromInput(e.target.value));
            setError(null);
          }}
        />
        <ErrorText id="join-code-error" error={error} />
        <button type="submit" className="btn btn-primary btn-block btn-large">
          Join
        </button>
      </form>
    </section>
  );
}

function CreateRoomCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="card" aria-labelledby="create-title">
      <h2 id="create-title" className="card-title">
        Host a game
      </h2>
      {open ? (
        <CreateRoomForm />
      ) : (
        <button type="button" className="btn btn-secondary btn-block btn-large" onClick={() => setOpen(true)}>
          Create a room
        </button>
      )}
    </section>
  );
}

function CreateRoomForm() {
  const [profile] = useState(() => loadProfile());
  const [name, setName] = useState(profile.name ?? "");
  const [avatar, setAvatar] = useState<Avatar>(() => profile.avatar ?? randomAvatar());
  const [customCode, setCustomCode] = useState("");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const nameCheck = validateNickname(name);
  const codeCheck = customCode.trim() === "" ? null : validateCustomRoomCode(customCode);
  const passwordCheck = password === "" ? null : validateRoomPassword(password);
  const codeHint = codeCheck && !codeCheck.ok ? codeCheck.reason : codeError;
  const passwordHint = passwordCheck && !passwordCheck.ok ? passwordCheck.reason : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (!nameCheck.ok || (codeCheck && !codeCheck.ok) || (passwordCheck && !passwordCheck.ok)) return;
    const payload: CreateRoomPayload = { name: nameCheck.value, avatar };
    if (codeCheck?.ok) payload.customCode = codeCheck.value;
    if (passwordCheck?.ok) payload.password = passwordCheck.value;
    setPending(true);
    const result = await createRoom(payload);
    setPending(false);
    if (result.ok) return;
    const { code } = result.error;
    if (code === "CODE_TAKEN") setCodeError("That code is taken. Try another.");
    else if (code === "CODE_INVALID") setCodeError(result.error.message || friendlyError(result.error));
    else if (code === "INVALID_NAME" || code === "NAME_TAKEN") setNameError(friendlyError(result.error));
    else setFormError(friendlyError(result.error));
  };

  return (
    <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
      <NicknameField
        id="create-name"
        value={name}
        onChange={(v) => {
          setName(v);
          setNameError(null);
        }}
        serverError={nameError}
        showValidation={submitted}
        autoFocus
      />
      <AvatarPicker idPrefix="create-avatar" value={avatar} onChange={setAvatar} />

      <details className="advanced">
        <summary>Room options (optional)</summary>
        <div className="stack">
          <div className="field">
            <label htmlFor="create-code">Custom room code</label>
            <input
              id="create-code"
              className={`input input-mono${codeHint ? " has-error" : ""}`}
              value={customCode}
              placeholder="e.g. PARTY"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={CUSTOM_CODE_MAX_LENGTH + 4}
              aria-invalid={codeHint ? true : undefined}
              aria-describedby="create-code-hint"
              onChange={(e) => {
                setCustomCode(e.target.value.toUpperCase());
                setCodeError(null);
              }}
            />
            <div id="create-code-hint" className="field-hint" aria-live="polite">
              {codeHint ? (
                <span className="field-error">
                  <span aria-hidden="true">⚠ </span>
                  {codeHint}
                </span>
              ) : codeCheck?.ok ? (
                <span>Your link will end in /{codeCheck.value}</span>
              ) : (
                <span>4–8 letters or numbers. Leave empty for a random code.</span>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor="create-password">Password (private room)</label>
            <input
              id="create-password"
              className={`input${passwordHint ? " has-error" : ""}`}
              type="password"
              value={password}
              autoComplete="new-password"
              maxLength={ROOM_PASSWORD_MAX_LENGTH * 2}
              aria-invalid={passwordHint ? true : undefined}
              aria-describedby="create-password-hint"
              onChange={(e) => setPassword(e.target.value)}
            />
            <div id="create-password-hint" className="field-hint" aria-live="polite">
              {passwordHint ? (
                <span className="field-error">
                  <span aria-hidden="true">⚠ </span>
                  {passwordHint}
                </span>
              ) : (
                <span>Leave empty for an open room. Anyone with the code can join.</span>
              )}
            </div>
          </div>
        </div>
      </details>

      <ErrorText error={formError} />
      <button type="submit" className="btn btn-primary btn-block btn-large" disabled={pending}>
        {pending ? "Creating…" : "Create room"}
      </button>
    </form>
  );
}
