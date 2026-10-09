import type { ContentMode } from "@mafia/shared";
import { Icon } from "../art/icons";
import { MODE_INFO } from "../lib/copy";

/** Safe Mode / Normal Mode, always with a word and an icon (never colour alone). */
export function ModeBadge({ mode }: { mode: ContentMode }) {
  const info = MODE_INFO[mode];
  return (
    <span className={`mode-badge mode-badge-${mode}`} title={info.blurb}>
      <Icon name={info.icon} size={13} />
      {info.label}
    </span>
  );
}
