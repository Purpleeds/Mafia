import type { Avatar } from "@mafia/shared";
import { AVATAR_COLOR_HEX, AVATAR_ICON_EMOJI } from "../lib/avatars";

interface AvatarBadgeProps {
  avatar: Avatar;
  /** Diameter in px. */
  size?: number;
  /** Set when the badge is the only thing describing the avatar; otherwise it is decorative. */
  label?: string;
  className?: string;
}

export function AvatarBadge({ avatar, size = 40, label, className }: AvatarBadgeProps) {
  return (
    <span
      className={`avatar-badge${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.58), background: AVATAR_COLOR_HEX[avatar.color] }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="avatar-emoji">{AVATAR_ICON_EMOJI[avatar.icon]}</span>
    </span>
  );
}
