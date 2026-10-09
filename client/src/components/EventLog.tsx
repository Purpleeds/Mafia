import type { GameView, LogEntryView } from "@mafia/shared";
import { SKIP } from "@mafia/shared";
import { Icon, type IconName } from "../art/icons";
import { PHASE_LABEL } from "../lib/labels";
import { roleLabel, timelineDeath, wordsFor } from "../lib/wording";

function nameIn(view: GameView, id: string): string {
  return view.players.find((p) => p.id === id)?.name ?? view.spectators.find((s) => s.id === id)?.name ?? "Someone";
}

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** One log entry as words (in the room's mode), with an icon. Public facts only. */
export function describeLogEntry(entry: LogEntryView, view: GameView): { icon: IconName; text: string } {
  const settings = view.settings;
  // "Ana (Doctor) was sent home by the Mafia." Roles only when they're public.
  const who = (deaths: Extract<LogEntryView, { kind: "night" }>["deaths"]) =>
    deaths
      .map((d) => timelineDeath(nameIn(view, d.playerId), d.role ? ` (${roleLabel(d.role, settings)})` : "", d.cause, settings))
      .join(" ");
  switch (entry.kind) {
    case "night": {
      if (entry.deaths.length === 0) {
        return { icon: "sun", text: `Night ${entry.round}: everyone woke up${entry.saved ? ", thanks to the Doctor" : ""}.` };
      }
      return { icon: "moon", text: `Night ${entry.round}: ${who(entry.deaths)}` };
    }
    case "vote": {
      if (entry.outcome === "eliminated") return { icon: "ballot", text: `Day ${entry.round} vote: ${who(entry.deaths)}` };
      const what =
        entry.outcome === "skipped" ? "the town skipped" : entry.outcome === "tie" ? `it was a tie, so ${wordsFor(settings).tieNone.toLowerCase()}` : "nobody voted";
      return { icon: "scales", text: `Day ${entry.round} vote: ${what}.` };
    }
    case "revote":
      return {
        icon: "scales",
        text: `Day ${entry.round}: a tie between ${names(entry.tiedIds.map((id) => (id === SKIP ? "Skip" : nameIn(view, id))))}, so the town voted again.`,
      };
    case "kicked":
      return { icon: "userMinus", text: `${nameIn(view, entry.playerId)} was removed by the host.` };
    case "paused":
      return { icon: "pause", text: `The host paused the game (${PHASE_LABEL[entry.phase]}).` };
    case "resumed":
      return { icon: "play", text: `The host resumed the game (${PHASE_LABEL[entry.phase]}).` };
    case "time_added":
      return { icon: "plus", text: `The host added 30 seconds (${PHASE_LABEL[entry.phase]}).` };
    case "discussion_skipped":
      return {
        icon: "fastForward",
        text: entry.by === "host" ? `Day ${entry.round}: the host skipped to voting.` : `Day ${entry.round}: everyone was done talking, so voting started early.`,
      };
  }
}

/** "What's happened so far": every public event of this game, newest last. Collapsed until opened. */
export function EventLog({ view }: { view: GameView }) {
  if (view.log.length === 0 || view.phase === "GAME_OVER") return null;
  return (
    <details className="card event-log">
      <summary>
        <Icon name="history" size={18} />
        What&apos;s happened so far
        <span className="count">{view.log.length}</span>
      </summary>
      <ol className="event-list">
        {view.log.map((entry, i) => {
          const line = describeLogEntry(entry, view);
          return (
            <li key={i}>
              <Icon name={line.icon} size={16} />
              <span>{line.text}</span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
