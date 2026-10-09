import { ADD_TIME_SECONDS, type GameView } from "@mafia/shared";
import { Icon } from "../art/icons";
import { friendlyError } from "../lib/errors";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import { showToast } from "../state/store";

const TIMED = new Set(["ROLE_REVEAL", "NIGHT", "NIGHT_RESULTS", "DAY_DISCUSSION", "VOTING", "VOTE_RESULTS"]);

/** The host's timer buttons during a game: pause or resume, 30 more seconds, and skip to voting during the discussion. */
export function HostControls({ view }: { view: GameView }) {
  const action = useAction();
  if (!view.you?.isHost || !TIMED.has(view.phase)) return null;
  const paused = view.paused !== null;

  const run = (event: "host:pause" | "host:resume" | "host:addTime" | "host:skipToVoting") =>
    void action.run(() => call(event, {})).then((result) => {
      if (!result.ok) showToast(friendlyError(result.error));
    });

  return (
    <div className="host-controls" role="group" aria-label="Host controls">
      <span className="host-controls-label">
        <Icon name="crown" size={14} /> Host
      </span>
      <button type="button" className="btn btn-small" aria-pressed={paused} disabled={action.pending} onClick={() => run(paused ? "host:resume" : "host:pause")}>
        <Icon name={paused ? "play" : "pause"} size={16} />
        {paused ? "Resume" : "Pause"}
      </button>
      <button type="button" className="btn btn-small" disabled={action.pending} onClick={() => run("host:addTime")}>
        <Icon name="plus" size={16} />
        {ADD_TIME_SECONDS} s
        <span className="sr-only"> more</span>
      </button>
      {view.phase === "DAY_DISCUSSION" ? (
        <button type="button" className="btn btn-small" disabled={action.pending} onClick={() => run("host:skipToVoting")}>
          <Icon name="fastForward" size={16} />
          Skip to voting
        </button>
      ) : null}
    </div>
  );
}
