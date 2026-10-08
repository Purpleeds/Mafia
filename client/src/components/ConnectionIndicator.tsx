import { useAppState } from "../state/store";

const TEXT = { connected: "Online", reconnecting: "Reconnecting…", connecting: "Connecting…" } as const;
const ICON = { connected: "●", reconnecting: "◐", connecting: "◐" } as const;

/** Always-visible connection status: icon plus text, so it doesn't rely on colour. */
export function ConnectionIndicator() {
  const connection = useAppState((s) => s.connection);
  return (
    <span className={`conn-indicator conn-indicator-${connection}`} role="status" aria-live="polite">
      <span aria-hidden="true">{ICON[connection]} </span>
      {TEXT[connection]}
    </span>
  );
}
