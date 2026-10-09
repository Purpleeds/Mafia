import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CUSTOM_CODE_MAX_LENGTH,
  ROOM_PASSWORD_MAX_LENGTH,
  normalizeRoomCode,
  roomCodeFromPath,
  validateCustomRoomCode,
  validateNickname,
  validateRoomPassword,
  type Avatar,
  type CheckSeatResult,
  type CreateRoomPayload,
} from "@mafia/shared";
import { Logo } from "../art/Logo";
import { Icon } from "../art/icons";
import { AvatarPicker } from "../components/AvatarPicker";
import { ErrorText } from "../components/ErrorText";
import { NicknameField } from "../components/NicknameField";
import { PhotoField } from "../components/PhotoControls";
import { randomAvatar } from "../lib/avatars";
import { friendlyError } from "../lib/errors";
import { HOW_TO_PLAY_PATH, ROLE_GUIDE_PATH, goToRoom, navigate } from "../lib/router";
import { forgetSession, loadActiveRoom, loadProfile, loadSession } from "../lib/storage";
import { call } from "../net/socket";
import { createRoom } from "../state/controller";
import { useAppState } from "../state/store";
import { NoticeBanner } from "./NoticeBanner";
import { SoundButton } from "../components/SoundControls";

export function HomeScreen() {
  const notice = useAppState((s) => (s.notice && s.notice.roomCode === null ? s.notice : null));

  return (
    <div className="screen home">
      <SoundButton className="corner-sound" />
      <header className="home-header">
        <div className="logo">
          <Logo />
        </div>
        <h1>Mafia</h1>
        <p className="tagline">The party game of secrets and suspicion. Grab your friends and a phone each.</p>
      </header>

      <NoticeBanner notice={notice} />

      <RejoinBanner />

      <JoinByCode />
      <CreateRoomCard />

      <nav className="home-links" aria-label="Help">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(HOW_TO_PLAY_PATH)}>
          How to play
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(ROLE_GUIDE_PATH)}>
          Role guide
        </button>
      </nav>
    </div>
  );
}

const STAGE_TEXT: Record<CheckSeatResult["stage"], string> = {
  lobby: "Waiting in the lobby",
  in_game: "Game in progress",
  game_over: "The game just finished",
};

/**
 * "Rejoin your last game": shown when this device still has a seat in a room
 * that is still running. The server confirms both before the banner appears;
 * a seat that has gone is quietly forgotten.
 */
function RejoinBanner() {
  const sessionRoom = useAppState((s) => s.session?.roomCode ?? null);
  const connected = useAppState((s) => s.connection === "connected");
  const [saved] = useState(() => {
    const code = loadActiveRoom();
    return code ? loadSession(code) : null;
  });
  const [check, setCheck] = useState<
    { status: "checking" } | { status: "ok"; result: CheckSeatResult } | { status: "gone" } | { status: "unknown" }
  >({ status: "checking" });

  useEffect(() => {
    if (!saved || !connected) return;
    let cancelled = false;
    void call("room:checkSeat", { roomCode: saved.roomCode, sessionToken: saved.sessionToken }).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data.seatValid) setCheck({ status: "ok", result: result.data });
      else if (result.ok || result.error.code === "ROOM_NOT_FOUND") {
        // The room closed or the seat expired: nothing to come back to.
        if (sessionRoom !== saved.roomCode) forgetSession(saved.roomCode);
        setCheck({ status: "gone" });
      } else {
        // Couldn't check (busy or offline): offer it anyway; the room screen sorts it out.
        setCheck({ status: "unknown" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [saved, connected, sessionRoom]);

  const code = sessionRoom ?? saved?.roomCode ?? null;
  if (!code) return null;
  if (!sessionRoom && check.status !== "ok" && check.status !== "unknown") {
    if (check.status === "gone" || !saved) return null;
    return (
      <p className="field-hint center-text" role="status">
        <span className="spinner" aria-hidden="true" /> Checking your last game…
      </p>
    );
  }
  const stage = check.status === "ok" ? STAGE_TEXT[check.result.stage] : null;
  return (
    <section className="card card-highlight rejoin" aria-labelledby="rejoin-title">
      <h2 id="rejoin-title" className="card-title">
        Rejoin your last game
      </h2>
      <p className="card-lead">
        Room {code}
        {stage ? ` · ${stage}` : ""}
      </p>
      <button type="button" className="btn btn-primary btn-block" onClick={() => goToRoom(code)}>
        Rejoin room {code}
      </button>
    </section>
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
  const [status, setStatus] = useState<"idle" | "looking" | "missing" | "offline">("idle");
  const ticket = useRef(0);
  const normalized = normalizeRoomCode(code);

  // Auto-advance: once the typed code is a real room, go straight to it. Waits a moment after the
  // last keystroke, so longer custom codes (up to 8 characters) can still be typed.
  useEffect(() => {
    setStatus("idle");
    if (!normalized) return;
    const mine = ++ticket.current;
    const timer = window.setTimeout(() => {
      setStatus("looking");
      void call("room:peek", { roomCode: normalized }).then((result) => {
        if (ticket.current !== mine) return;
        if (result.ok) goToRoom(normalized);
        else setStatus(result.error.code === "ROOM_NOT_FOUND" ? "missing" : "offline");
      });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      ticket.current++;
    };
  }, [normalized]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!normalized) {
      setError("Room codes are 4–8 letters or numbers, like ABCD.");
      return;
    }
    goToRoom(normalized);
  };

  return (
    <section className="card" aria-labelledby="join-title">
      <h2 id="join-title" className="card-title">
        Join Room
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
          maxLength={CUSTOM_CODE_MAX_LENGTH + 24}
          enterKeyHint="go"
          aria-describedby="join-code-error join-code-status"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setCode(codeFromInput(e.target.value));
            setError(null);
          }}
        />
        <p id="join-code-status" className="field-hint center-text" role="status">
          {status === "looking" ? (
            <>
              <span className="spinner" aria-hidden="true" /> Looking for room {normalized}…
            </>
          ) : status === "missing" ? (
            `No room found with code ${normalized}. Check the code (some are longer).`
          ) : status === "offline" ? (
            "Can't reach the server right now."
          ) : (
            "Type the code and you'll jump straight in."
          )}
        </p>
        <ErrorText id="join-code-error" error={error} />
        <button type="submit" className="btn btn-primary btn-block btn-large">
          Join Room
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
          Create Room
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
      <PhotoField avatar={avatar} />

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
                  <Icon name="warn" size={15} /> {codeHint}
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
                  <Icon name="warn" size={15} /> {passwordHint}
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
        {pending ? "Creating…" : "Create Room"}
      </button>
    </form>
  );
}
