import type { ReactNode } from "react";
import type { PublicPlayerView } from "@mafia/shared";
import { Icon } from "../art/icons";
import { AvatarBadge } from "./AvatarBadge";
import { BotTag } from "./BotTag";
import { NOTE_TAG_LABEL, type Notes } from "../lib/notes";
import { OUTSIDE_A_ROOM, roleLabel, wordsFor, type WordingSettings } from "../lib/wording";

interface PlayerGridProps {
  players: PublicPlayerView[];
  youId: string | null;
  /** Accessible name for the group. */
  label: string;
  /** Makes alive players tappable. Return false to grey a player out. */
  canPick?: (player: PublicPlayerView) => boolean;
  selectedIds?: readonly string[];
  onPick?: (playerId: string) => void;
  /** Extra content per player (vote counts, markers). */
  badges?: Record<string, ReactNode>;
  /** Short text under the name. */
  captions?: Record<string, string>;
  /** Appended after the players (e.g. a "Skip" card). */
  extra?: ReactNode;
  /** Hide eliminated players. */
  hideOut?: boolean;
  /** Players who just left the game: they fade out as the card appears. */
  fadingIds?: readonly string[];
  /** The room's mode and gang name, for the words under people who have left. */
  wording?: WordingSettings;
  /** Taps here don't make the generic click sound (the screen plays its own). */
  silentClicks?: boolean;
  /** Keyboard shortcut shown on each pickable card ("1", "2"... ) on computers. */
  keyFor?: (playerId: string) => string | null;
  /** Your private notes: the tag shows on the card (on your screen only). */
  notes?: Notes;
}

/** Big, tappable player cards. The same component draws the real and the decoy night grids. */
export function PlayerGrid({
  players,
  youId,
  label,
  canPick,
  selectedIds = [],
  onPick,
  badges,
  captions,
  extra,
  hideOut,
  fadingIds = [],
  wording = OUTSIDE_A_ROOM,
  silentClicks,
  keyFor,
  notes,
}: PlayerGridProps) {
  const shown = players.filter((p) => !(hideOut && (!p.alive || p.kicked)));
  return (
    <ul className="grid-cards" aria-label={label} data-sound={silentClicks ? "none" : undefined}>
      {shown.map((p) => {
        const out = !p.alive || p.kicked;
        const pickable = !!canPick && !out;
        const enabled = pickable && canPick(p);
        const selected = selectedIds.includes(p.id);
        const caption = captions?.[p.id];
        const key = enabled ? (keyFor?.(p.id) ?? null) : null;
        const tag = notes?.[p.id]?.tag ?? null;
        const content = (
          <>
            {key ? (
              <kbd className="pcard-key" aria-hidden="true">
                {key}
              </kbd>
            ) : null}
            <span className="pcard-badges">{badges?.[p.id]}</span>
            <AvatarBadge avatar={p.avatar} size={52} />
            <span className="pcard-name">
              {p.name}
              <BotTag player={p} />
              {p.id === youId ? <span className="you-tag"> (you)</span> : null}
            </span>
            {out ? (
              <span className="pcard-caption">
                <Icon name={wordsFor(wording).outIcon} size={13} />{" "}
                {p.kicked ? "Removed" : p.role ? `Out · ${roleLabel(p.role, wording)}` : "Out"}
              </span>
            ) : caption ? (
              <span className="pcard-caption">{caption}</span>
            ) : null}
            {tag && !out ? <span className={`pcard-note note-tag-${tag}`}>{NOTE_TAG_LABEL[tag]}</span> : null}
            {selected ? (
              <span className="pcard-check" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
            ) : null}
          </>
        );
        const fading = out && fadingIds.includes(p.id);
        const className = `pcard${out ? " is-out" : ""}${fading ? " is-fading" : ""}${selected ? " is-selected" : ""}${p.id === youId ? " is-you" : ""}`;
        return (
          <li key={p.id}>
            {pickable ? (
              <button
                type="button"
                className={className}
                disabled={!enabled}
                aria-pressed={selected}
                onClick={() => onPick?.(p.id)}
              >
                {content}
              </button>
            ) : (
              <div className={className}>{content}</div>
            )}
          </li>
        );
      })}
      {extra ? <li>{extra}</li> : null}
    </ul>
  );
}
