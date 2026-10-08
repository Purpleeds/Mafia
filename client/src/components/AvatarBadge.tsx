import type { Avatar } from "@mafia/shared";
import { Character } from "../art/avatar";

interface AvatarBadgeProps {
  avatar: Avatar;
  /** Diameter in px. */
  size?: number;
  /** Set when the badge is the only thing describing the avatar; otherwise it is decorative. */
  label?: string;
  className?: string;
}

/** A player's procedurally drawn character in a round frame. */
export function AvatarBadge({ avatar, size = 40, label, className }: AvatarBadgeProps) {
  return (
    <span
      className={`avatar-badge${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Character avatar={avatar} />
    </span>
  );
}
