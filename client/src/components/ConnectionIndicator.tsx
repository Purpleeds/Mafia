import { useAppState } from "../state/store";

const TEXT = { connected: "Online", reconnecting: "Reconnecting…", connecting: "Connecting…" } as const;

/**
 * Always-visible connection status: a dot plus text, so it doesn't rely on colour.
 * `compact` keeps just the dot while everything is fine (the text stays for screen
 * readers) and shows the words only when the connection has a problem.
 */
export function ConnectionIndicator({ compact }: { compact?: boolean }) {
  const connection = useAppState((s) => s.connection);
  const hideText = compact && connection === "connected";
  return (
    <span className={`conn-indicator conn-indicator-${connection}`} role="status" aria-live="polite" title={TEXT[connection]}>
      <span className={`conn-dot conn-dot-${connection}`} aria-hidden="true" />
      <span className={hideText ? "sr-only" : undefined}>{TEXT[connection]}</span>
    </span>
  );
}
