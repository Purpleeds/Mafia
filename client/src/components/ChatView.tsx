import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_CHAT_LENGTH, containsLink, type AvatarView, type ChatMessage, type ChatReaction } from "@mafia/shared";
import { Icon } from "../art/icons";
import { displayChatText, setMuted, useMuted, usePrefs } from "../lib/prefs";
import { REACTIONS, reactionLabel } from "../lib/reactions";
import { AvatarBadge } from "./AvatarBadge";
import { ChatFilterToggle, UncensoredNotice } from "./ChatNotices";

interface ChatViewProps {
  messages: ChatMessage[];
  youId: string | null;
  /** The room, for remembering who you muted. */
  roomCode: string;
  /** Null when nobody can write here (read-only). */
  onSend: ((text: string) => Promise<string | null>) | null;
  /** Quick reactions; offered whenever typing is. Returns an error message or null. */
  onReact?: ((reaction: ChatReaction) => Promise<string | null>) | null;
  avatarOf: (senderId: string) => AvatarView | null;
  placeholder: string;
  /** Shown instead of the input when reading only. */
  readOnlyNote?: string;
  emptyText?: string;
  label: string;
  /** The host chose uncensored chat: say so above the messages. */
  uncensored?: boolean;
}

/** A message list and input. Used for the day chat, the graveyard and the Mafia whisper. */
export function ChatView({
  messages,
  youId,
  roomCode,
  onSend,
  onReact,
  avatarOf,
  placeholder,
  readOnlyNote,
  emptyText,
  label,
  uncensored,
}: ChatViewProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [muting, setMuting] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const prefs = usePrefs();
  const muted = useMuted(roomCode);

  const shown = messages.filter((m) => !muted.includes(m.senderId) || m.senderId === youId);
  const hiddenCount = messages.length - shown.length;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [shown.length]);

  const [reacting, setReacting] = useState(false);
  const react = async (reaction: ChatReaction) => {
    if (!onReact || reacting) return;
    setReacting(true);
    const problem = await onReact(reaction);
    setReacting(false);
    setError(problem);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || !onSend || pending) return;
    // The server blocks links too; saying so straight away saves a round trip.
    if (containsLink(value)) {
      setError("Links can't be shared in chat.");
      return;
    }
    setPending(true);
    const problem = await onSend(value);
    setPending(false);
    if (problem) setError(problem);
    else {
      setText("");
      setError(null);
    }
  };

  return (
    <div className="chat">
      {uncensored ? <UncensoredNotice /> : null}
      <ul className="chat-list" ref={listRef} aria-label={label} aria-live="polite" tabIndex={0}>
        {shown.length === 0 ? <li className="chat-empty">{emptyText ?? "No messages yet."}</li> : null}
        {shown.map((m) => {
          const avatar = avatarOf(m.senderId);
          const mine = m.senderId === youId;
          return (
            <li key={m.id} className={`chat-msg${mine ? " is-mine" : ""}${m.reaction ? " is-reaction" : ""}`}>
              {avatar ? <AvatarBadge avatar={avatar} size={28} /> : <span className="chat-avatar-gap" />}
              <div className="chat-bubble">
                {mine ? (
                  <span className="chat-name">You</span>
                ) : (
                  <button
                    type="button"
                    className="chat-name chat-name-button"
                    aria-expanded={muting === m.id}
                    onClick={() => setMuting((current) => (current === m.id ? null : m.id))}
                  >
                    {m.senderName}
                    <span className="sr-only">: options</span>
                  </button>
                )}
                {m.reaction ? (
                  <span className="chat-text chat-reaction">{reactionLabel(m.reaction)}</span>
                ) : (
                  <span className="chat-text">{displayChatText(m.text, prefs)}</span>
                )}
                {muting === m.id ? (
                  <span className="chat-msg-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => {
                        setMuted(roomCode, m.senderId, true);
                        setMuting(null);
                      }}
                    >
                      <Icon name="chatOff" size={16} />
                      Mute {m.senderName}
                    </button>
                    <span className="field-hint">Only on your screen. They won't know.</span>
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 ? (
        <MutedSummary count={hiddenCount} roomCode={roomCode} ids={muted} messages={messages} />
      ) : null}
      {onSend && onReact ? (
        <div className="reaction-bar" role="group" aria-label="Quick reactions">
          {REACTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="btn btn-small reaction-btn"
              disabled={reacting}
              onClick={() => void react(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
      {onSend ? (
        <form className="chat-form" onSubmit={(e) => void submit(e)}>
          <label htmlFor="chat-input" className="sr-only">
            {placeholder}
          </label>
          <input
            id="chat-input"
            className="input"
            value={text}
            maxLength={MAX_CHAT_LENGTH}
            placeholder={placeholder}
            autoComplete="off"
            enterKeyHint="send"
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={pending || text.trim() === ""}>
            Send
          </button>
        </form>
      ) : (
        <p className="field-hint">{readOnlyNote ?? "You can read, but not write, here."}</p>
      )}
      {error ? (
        <p className="error-text" role="alert">
          <Icon name="warn" size={16} />
          {error}
        </p>
      ) : null}
      <ChatFilterToggle />
    </div>
  );
}

/** "3 messages from muted players are hidden", with a way to unmute each of them. */
function MutedSummary({
  count,
  roomCode,
  ids,
  messages,
}: {
  count: number;
  roomCode: string;
  ids: readonly string[];
  messages: ChatMessage[];
}) {
  const [open, setOpen] = useState(false);
  const names = new Map(messages.map((m) => [m.senderId, m.senderName]));
  const mutedHere = ids.filter((id) => names.has(id));
  return (
    <div className="chat-muted">
      <button type="button" className="btn btn-ghost btn-small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="chatOff" size={16} />
        {count} {count === 1 ? "message" : "messages"} from muted players hidden
      </button>
      {open ? (
        <div className="button-row">
          {mutedHere.map((id) => (
            <button key={id} type="button" className="btn btn-small" onClick={() => setMuted(roomCode, id, false)}>
              Unmute {names.get(id)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
