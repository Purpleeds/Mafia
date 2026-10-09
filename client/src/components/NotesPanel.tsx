import type { GameView } from "@mafia/shared";
import { Icon } from "../art/icons";
import { NOTE_MAX_LENGTH, NOTE_TAGS, NOTE_TAG_LABEL, gameKey, setNote, useNotes } from "../lib/notes";
import { AvatarBadge } from "./AvatarBadge";

/**
 * "My notes": tag the other players Suspect, Trust or Unsure and jot a few
 * words. Saved on this device only, never sent anywhere, and cleared when the
 * game ends.
 */
export function NotesPanel({ view, roomCode }: { view: GameView; roomCode: string }) {
  const game = gameKey(roomCode, view.gameNumber);
  const notes = useNotes(game);
  const youId = view.you?.id;
  const others = view.players.filter((p) => p.id !== youId && !p.kicked);
  if (others.length === 0 || view.phase === "GAME_OVER") return null;
  const tagged = Object.values(notes).filter((n) => n.tag !== null || n.text.trim() !== "").length;

  return (
    <details className="card notes-panel">
      <summary>
        <Icon name="notes" size={18} />
        My notes
        {tagged > 0 ? <span className="count">{tagged}</span> : null}
        <span className="field-hint"> (only on this device)</span>
      </summary>
      <ul className="notes-list">
        {others.map((p) => {
          const note = notes[p.id] ?? { tag: null, text: "" };
          const out = !p.alive;
          return (
            <li key={p.id} className={`note-row${out ? " is-out" : ""}`}>
              <div className="note-head">
                <AvatarBadge avatar={p.avatar} size={28} />
                <span className="note-name">{p.name}</span>
                <span className="note-tags" role="group" aria-label={`Tag ${p.name}`}>
                  {NOTE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`note-tag note-tag-${tag}${note.tag === tag ? " is-selected" : ""}`}
                      aria-pressed={note.tag === tag}
                      onClick={() => setNote(game, p.id, { ...note, tag: note.tag === tag ? null : tag })}
                    >
                      {NOTE_TAG_LABEL[tag]}
                    </button>
                  ))}
                </span>
              </div>
              <label className="sr-only" htmlFor={`note-${p.id}`}>
                Note about {p.name}
              </label>
              <input
                id={`note-${p.id}`}
                className="input input-small"
                value={note.text}
                maxLength={NOTE_MAX_LENGTH}
                placeholder="A short note…"
                autoComplete="off"
                onChange={(e) => setNote(game, p.id, { ...note, text: e.target.value })}
              />
            </li>
          );
        })}
      </ul>
    </details>
  );
}
