import { AVATAR_COLORS, AVATAR_ICONS, type Avatar } from "@mafia/shared";
import { AVATAR_COLOR_HEX, AVATAR_ICON_EMOJI, avatarLabel, colorLabel, iconLabel, randomAvatar } from "../lib/avatars";
import { AvatarBadge } from "./AvatarBadge";

interface AvatarPickerProps {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
  idPrefix: string;
}

export function AvatarPicker({ value, onChange, idPrefix }: AvatarPickerProps) {
  return (
    <fieldset className="avatar-picker">
      <legend>Avatar</legend>
      <div className="avatar-preview">
        <AvatarBadge avatar={value} size={64} label={`Your avatar: ${avatarLabel(value)}`} />
        <button type="button" className="btn btn-ghost" onClick={() => onChange(randomAvatar())}>
          🎲 Surprise me
        </button>
      </div>

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
              {selected ? <span aria-hidden="true">✓</span> : null}
            </button>
          );
        })}
      </div>

      <div className="picker-label" id={`${idPrefix}-icons`}>
        Icon
      </div>
      <div className="icon-grid" role="radiogroup" aria-labelledby={`${idPrefix}-icons`}>
        {AVATAR_ICONS.map((icon) => {
          const selected = value.icon === icon;
          return (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={iconLabel(icon)}
              title={iconLabel(icon)}
              className={`icon-choice${selected ? " is-selected" : ""}`}
              style={selected ? { background: AVATAR_COLOR_HEX[value.color] } : undefined}
              onClick={() => onChange({ ...value, icon })}
            >
              <span aria-hidden="true">{AVATAR_ICON_EMOJI[icon]}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
