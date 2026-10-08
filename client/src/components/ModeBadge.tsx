import type { ContentMode } from "@mafia/shared";
import { Icon } from "../art/icons";
import { MODE_INFO } from "../lib/copy";

/** Safe Mode / Normal Mode, always with a word and an icon (never colour alone). */
export function ModeBadge({ mode, large }: { mode: ContentMode; large?: boolean }) {
  const info = MODE_INFO[mode];
  return (
    <span className={`mode-badge mode-badge-${mode}${large ? " is-large" : ""}`} title={info.blurb}>
      <Icon name={info.icon} size={large ? 18 : 15} />
      {info.label}
    </span>
  );
}
