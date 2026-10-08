import { useState } from "react";
import { AVATAR_COLORS, type Avatar } from "@mafia/shared";
import { Icon } from "../art/icons";
import { randomSeed } from "../art/rng";
import { AVATAR_COLOR_HEX, avatarLabel, colorLabel, randomAvatar } from "../lib/avatars";
import { AvatarBadge } from "./AvatarBadge";

interface AvatarPickerProps {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
  idPrefix: string;
}

const CHOICES = 8;

function freshLooks(keep: string): string[] {
  return [keep, ...Array.from({ length: CHOICES - 1 }, randomSeed)];
}

/** Pick a look (characters generated from seeds) and a colour. */
export function AvatarPicker({ value, onChange, idPrefix }: AvatarPickerProps) {
  const [looks, setLooks] = useState<string[]>(() => freshLooks(value.seed));
  const shownLooks = looks.includes(value.seed) ? looks : [value.seed, ...looks.slice(1)];

  return (
    <fieldset className="avatar-picker">
      <legend>Avatar</legend>
      <div className="avatar-preview">
        <AvatarBadge avatar={value} size={76} label={`Your avatar: ${avatarLabel(value)}`} />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const next = randomAvatar();
            setLooks(freshLooks(next.seed));
            onChange(next);
          }}
        >
          <Icon name="dice" /> Surprise me
        </button>
      </div>

      <div className="picker-label" id={`${idPrefix}-looks`}>
        Look
      </div>
      <div className="look-grid" role="radiogroup" aria-labelledby={`${idPrefix}-looks`}>
        {shownLooks.map((seed, i) => {
          const selected = value.seed === seed;
          const candidate = { color: value.color, seed };
          return (
            <button
              key={`${seed}-${i}`}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Look ${i + 1}: ${avatarLabel(candidate)}`}
              className={`look-choice${selected ? " is-selected" : ""}`}
              onClick={() => onChange(candidate)}
            >
              <AvatarBadge avatar={candidate} size={54} />
            </button>
          );
        })}
      </div>
      <button type="button" className="btn btn-small btn-ghost more-looks" onClick={() => setLooks(freshLooks(value.seed))}>
        <Icon name="dice" size={16} /> More looks
      </button>

      <div className="picker-label" id={`${idPrefix}-colors`}>
        Colour
      </div>
      <div className="swatch-grid" role="radiogroup" aria-labelledby={`${idPrefix}-colors`}>
        {AVATAR_COLORS.map((color) => {
          const selected = value.color === color;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={colorLabel(color)}
              title={colorLabel(color)}
              className={`swatch${selected ? " is-selected" : ""}`}
              style={{ background: AVATAR_COLOR_HEX[color] }}
              onClick={() => onChange({ ...value, color })}
            >
              {selected ? <Icon name="check" size={18} /> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
