import type { AvatarView } from "@mafia/shared";
import { Character } from "../art/avatar";
import { useAppState } from "../state/store";

interface AvatarBadgeProps {
  /** The generated look, plus the id of the player's own picture when it is showing. */
  avatar: AvatarView;
  /** Diameter in px. */
  size?: number;
  /** Set when the badge is the only thing describing the avatar; otherwise it is decorative. */
  label?: string;
  className?: string;
  /** Show this picture (a data URL) instead, e.g. a preview of your own before it is uploaded. */
  previewUrl?: string | null;
}

/**
 * A player's avatar in a round frame: their own picture when they uploaded one
 * and it is showing, otherwise their procedurally drawn character (also while
 * the picture is still on its way).
 */
export function AvatarBadge({ avatar, size = 40, label, className, previewUrl }: AvatarBadgeProps) {
  const photo = useAppState((s) => (avatar.photo ? s.avatarImages[avatar.photo] : undefined));
  const src = previewUrl ?? photo;
  return (
    <span
      className={`avatar-badge${src ? " has-photo" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {src ? <img className="avatar-photo" src={src} alt="" width={size} height={size} draggable={false} /> : <Character avatar={avatar} />}
    </span>
  );
}
