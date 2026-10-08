import type { ContentMode } from "@mafia/shared";

/**
 * Placeholder for the themed animated background (a later step adds shaders).
 * Purely decorative; colours come from the CSS variables for the mode.
 */
export function Background({ mode }: { mode: ContentMode }) {
  return <div className="background" data-mode={mode} aria-hidden="true" />;
}
