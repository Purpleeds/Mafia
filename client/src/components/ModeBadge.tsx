import type { ContentMode } from "@mafia/shared";
import { MODE_INFO } from "../lib/copy";

/** Safe Mode / Normal Mode, always with a word and an icon (never colour alone). */
export function ModeBadge({ mode, large }: { mode: ContentMode; large?: boolean }) {
  const info = MODE_INFO[mode];
  return (
    <span className={`mode-badge mode-badge-${mode}${large ? " is-large" : ""}`} title={info.blurb}>
      <span aria-hidden="true">{info.emoji}</span> {info.label}
    </span>
  );
}
