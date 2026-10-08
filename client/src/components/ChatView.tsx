import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_CHAT_LENGTH, type Avatar, type ChatMessage } from "@mafia/shared";
import { AvatarBadge } from "./AvatarBadge";

interface ChatViewProps {
  messages: ChatMessage[];
  youId: string | null;
  /** Null when nobody can write here (read-only). */
  onSend: ((text: string) => Promise<string | null>) | null;
  avatarOf: (senderId: string) => Avatar | null;
  placeholder: string;
  /** Shown instead of the input when reading only. */
  readOnlyNote?: string;
  emptyText?: string;
  label: string;
}

/** A message list and input. Used for the day chat, the graveyard and the Mafia whisper. */
export function ChatView({ messages, youId, onSend, avatarOf, placeholder, readOnlyNote, emptyText, label }: ChatViewProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

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
                <span className="chat-text">{m.text}</span>
              </div>
            </li>
          );
        })}
      </ul>
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
