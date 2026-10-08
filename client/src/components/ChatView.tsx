import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_CHAT_LENGTH, type Avatar, type ChatMessage, type ChatReaction } from "@mafia/shared";
import { Icon } from "../art/icons";
import { REACTIONS, reactionInfo } from "../lib/reactions";
import { AvatarBadge } from "./AvatarBadge";

interface ChatViewProps {
  messages: ChatMessage[];
  youId: string | null;
  /** Null when nobody can write here (read-only). */
  onSend: ((text: string) => Promise<string | null>) | null;
  /** Quick reactions; offered whenever typing is. Returns an error message or null. */
  onReact?: ((reaction: ChatReaction) => Promise<string | null>) | null;
  avatarOf: (senderId: string) => Avatar | null;
  placeholder: string;
  /** Shown instead of the input when reading only. */
  readOnlyNote?: string;
  emptyText?: string;
  label: string;
}

/** A message list and input. Used for the day chat, the graveyard and the Mafia whisper. */
export function ChatView({ messages, youId, onSend, onReact, avatarOf, placeholder, readOnlyNote, emptyText, label }: ChatViewProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

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
      <ul className="chat-list" ref={listRef} aria-label={label} aria-live="polite" tabIndex={0}>
        {messages.length === 0 ? <li className="chat-empty">{emptyText ?? "No messages yet."}</li> : null}
        {messages.map((m) => {
          const avatar = avatarOf(m.senderId);
          const mine = m.senderId === youId;
          return (
            <li key={m.id} className={`chat-msg${mine ? " is-mine" : ""}`}>
              {avatar ? <AvatarBadge avatar={avatar} size={28} /> : <span className="chat-avatar-gap" />}
              <div className="chat-bubble">
                <span className="chat-name">{mine ? "You" : m.senderName}</span>
                {m.reaction ? (
                  <span className="chat-text chat-reaction">
                    <Icon name={reactionInfo(m.reaction).icon} size={26} />
                    <span className="sr-only">{reactionInfo(m.reaction).label}</span>
                    <span aria-hidden="true">{reactionInfo(m.reaction).label}</span>
                  </span>
                ) : (
                  <span className="chat-text">{m.text}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {onSend && onReact ? (
        <div className="reaction-bar" role="group" aria-label="Quick reactions">
          {REACTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="btn btn-small reaction-btn"
              aria-label={r.label}
              title={r.label}
              disabled={reacting}
              onClick={() => void react(r.id)}
            >
              <Icon name={r.icon} size={24} />
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
          {error}
        </p>
      ) : null}
    </div>
  );
}
