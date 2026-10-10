import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { DevDebugSnapshot } from "@mafia/shared";
import { friendlyError } from "../lib/errors";
import { useDevMode } from "../lib/dev";
import { call } from "../net/socket";
import { useAppState } from "../state/store";

/** A collapsible view of any JSON value. */
function JsonNode({ name, value, depth }: { name: string | null; value: unknown; depth: number }): ReactNode {
  const label = name === null ? null : <span className="json-key">{name}: </span>;
  if (value === null || typeof value !== "object") {
    const text = typeof value === "string" ? JSON.stringify(value) : String(value);
    return (
      <div className="json-row">
        {label}
        <span className={`json-${value === null ? "null" : typeof value}`}>{text}</span>
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  if (entries.length === 0) {
    return (
      <div className="json-row">
        {label}
        <span className="json-null">{Array.isArray(value) ? "[]" : "{}"}</span>
      </div>
    );
  }
  return (
    <details className="json-node" open={depth < 1}>
      <summary>
        {label}
        <span className="json-summary">{summary}</span>
      </summary>
      <div className="json-children">
        {entries.map(([key, child]) => (
          <JsonNode key={key} name={key} value={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

interface DebugPlayer {
  id: string;
  name: string;
  role: string | null;
  alive: boolean;
  connected: boolean;
  kicked?: boolean;
}

function playersOf(state: unknown): DebugPlayer[] {
  if (typeof state !== "object" || state === null) return [];
  const players = (state as { players?: unknown }).players;
  return Array.isArray(players) ? (players as DebugPlayer[]) : [];
}

/** The server's whole game state, secrets included. Development only. */
export function DebugPanel() {
  const dev = useDevMode();
  const version = useAppState((s) => s.game?.payload.version ?? 0);
  const inRoom = useAppState((s) => s.game !== null);
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState(true);
  const [snapshot, setSnapshot] = useState<DevDebugSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const result = await call("dev:debugState", {});
    if (result.ok) {
      setSnapshot(result.data);
      setError(null);
    } else setError(friendlyError(result.error));
  }, []);

  // Fetch when opened, and again (slightly delayed, so a burst of bot moves is one fetch) whenever the game changes.
  useEffect(() => {
    if (!open || !auto) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void refresh(), 300);
    return () => window.clearTimeout(timer.current);
  }, [open, auto, version, refresh]);

  if (!dev || !inRoom) return null;

  const copy = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot.state, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy: the browser blocked the clipboard.");
    }
  };

  const state = snapshot?.state as { phase?: string; round?: number } | undefined;
  const botIds = new Set(snapshot?.botIds ?? []);
  const players = playersOf(snapshot?.state);

  return (
    <aside className="debug-panel" aria-label="Debug panel (development only)">
      {open ? (
        <div className="debug-body" role="dialog" aria-label="Server game state">
          <div className="debug-bar">
            <strong>Server state</strong>
            <span className="field-hint">
              {state?.phase ?? "…"} · round {state?.round ?? 0} · {snapshot?.members ?? 0} members · {snapshot?.chatMessages ?? 0} chat messages
              {snapshot?.timerAt ? ` · timer in ${Math.max(0, Math.round((snapshot.timerAt - snapshot.serverNow) / 1000))}s` : ""}
            </span>
            <label className="debug-check">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto refresh
            </label>
            <button type="button" className="btn btn-small" onClick={() => void refresh()}>
              Refresh
            </button>
            <button type="button" className="btn btn-small" onClick={() => void copy()} disabled={!snapshot}>
              {copied ? "Copied" : "Copy JSON"}
            </button>
            <button type="button" className="btn btn-small" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          {players.length > 0 ? (
            <table className="debug-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Role</th>
                  <th>Alive</th>
                  <th>Online</th>
                  <th>Bot</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id} className={p.alive ? "" : "is-out"}>
                    <td>{p.name}</td>
                    <td>{p.role ?? "—"}</td>
                    <td>{p.alive ? "yes" : "no"}</td>
                    <td>{p.connected ? "yes" : "no"}</td>
                    <td>{botIds.has(p.id) ? "bot" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div className="debug-json">{snapshot ? <JsonNode name={null} value={snapshot.state} depth={0} /> : <p className="field-hint">Loading…</p>}</div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-small debug-toggle"
          data-sound="none"
          onClick={() => setOpen(true)}
        >
          Debug
        </button>
      )}
    </aside>
  );
}
