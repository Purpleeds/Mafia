import type { ReactNode } from "react";
import type { PublicPlayerView } from "@mafia/shared";
import { Icon } from "../art/icons";
import { AvatarBadge } from "./AvatarBadge";

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
}: PlayerGridProps) {
  const shown = players.filter((p) => !(hideOut && (!p.alive || p.kicked)));
  return (
    <ul className="grid-cards" aria-label={label}>
      {shown.map((p) => {
        const out = !p.alive || p.kicked;
        const pickable = !!canPick && !out;
        const enabled = pickable && canPick(p);
        const selected = selectedIds.includes(p.id);
        const caption = captions?.[p.id];
        const content = (
          <>
            <span className="pcard-badges">{badges?.[p.id]}</span>
            <AvatarBadge avatar={p.avatar} size={52} />
            <span className="pcard-name">
              {p.name}
              {p.id === youId ? <span className="you-tag"> (you)</span> : null}
            </span>
            {out ? (
              <span className="pcard-caption">
                <Icon name="grave" size={13} />{" "}
                {p.kicked ? "Removed" : p.role ? `Out · ${p.role}` : "Out"}
              </span>
            ) : caption ? (
              <span className="pcard-caption">{caption}</span>
            ) : null}
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
