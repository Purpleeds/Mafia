import { useSyncExternalStore } from "react";

/**
 * Private notes about other players: a tag (Suspect, Trust, Unsure) and a few
 * words each. Kept on this device only, never sent to the server, and only for
 * the game being played: they're cleared once it ends.
 */
export const NOTE_TAGS = ["suspect", "trust", "unsure"] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];
export const NOTE_TAG_LABEL: Record<NoteTag, string> = { suspect: "Suspect", trust: "Trust", unsure: "Unsure" };
export const NOTE_MAX_LENGTH = 80;

export interface PlayerNote {
  tag: NoteTag | null;
  text: string;
}

export type Notes = Record<string, PlayerNote>;

interface StoredNotes {
  /** room code and game number: notes belong to one game. */
  game: string;
  notes: Notes;
}

const NOTES_KEY = "mafia.notes";
const EMPTY: Notes = {};

export function gameKey(roomCode: string, gameNumber: number): string {
  return `${roomCode}#${gameNumber}`;
}

function isNote(value: unknown): value is PlayerNote {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.tag === null || (NOTE_TAGS as readonly unknown[]).includes(v.tag)) && typeof v.text === "string";
}

export function parseNotes(raw: string | null): StoredNotes | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.game !== "string" || typeof value.notes !== "object" || value.notes === null) return null;
    const notes: Notes = {};
    for (const [id, note] of Object.entries(value.notes as Record<string, unknown>)) {
      if (isNote(note)) notes[id] = { tag: note.tag, text: note.text.slice(0, NOTE_MAX_LENGTH) };
    }
    return { game: value.game, notes };
  } catch {
    return null;
  }
}

function read(): StoredNotes | null {
  try {
    return parseNotes(window.localStorage.getItem(NOTES_KEY));
  } catch {
    return null;
  }
}

let stored: StoredNotes | null = typeof window === "undefined" ? null : read();
const listeners = new Set<() => void>();

function save(next: StoredNotes | null): void {
  stored = next;
  try {
    if (next) window.localStorage.setItem(NOTES_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(NOTES_KEY);
  } catch {
    // storage blocked: notes last for this visit
  }
  for (const listener of listeners) listener();
}

/** The notes for this game (empty for any other game). */
export function notesFor(game: string): Notes {
  return stored?.game === game ? stored.notes : EMPTY;
}

export function setNote(game: string, playerId: string, note: PlayerNote): void {
  const notes = { ...notesFor(game) };
  const text = note.text.slice(0, NOTE_MAX_LENGTH);
  if (note.tag === null && text.trim() === "") delete notes[playerId];
  else notes[playerId] = { tag: note.tag, text };
  save({ game, notes });
}

/** The game is over (or a new one began): forget every note. */
export function clearNotes(): void {
  if (stored) save(null);
}

export function useNotes(game: string): Notes {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => notesFor(game),
    () => notesFor(game),
  );
}
