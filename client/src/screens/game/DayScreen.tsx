import { Icon } from "../../art/icons";
import { ErrorText } from "../../components/ErrorText";
import { PlayerGrid } from "../../components/PlayerGrid";
import { haptic } from "../../lib/haptics";
import { gameKey, useNotes } from "../../lib/notes";
import { useAction } from "../../lib/useAction";
import { fill } from "../../lib/wording";
import { call } from "../../net/socket";
import { myPlayer, type PhaseProps } from "./common";

/** Day discussion: who's still in, last night's news, and "Done talking" (voting starts early once everyone is). */
export function DayScreen({ received }: PhaseProps) {
  const { view, room } = received.payload;
  const you = view.you;
  const me = myPlayer(view);
  const notes = useNotes(gameKey(room.code, view.gameNumber));
  const recap = view.narration?.kind === "night" && view.narration.status === "ready" ? view.narration.text : null;
  const alive = view.players.filter((p) => p.alive && !p.kicked).length;

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">{fill(`Day ${view.round}: who is {theGang}?`, view.settings)}</h2>
        <p className="field-hint">
          {alive} players are still in. Talk it over in the chat (or out loud). Voting starts when the timer ends.
        </p>
        <PlayerGrid players={view.players} youId={you?.id ?? null} label="Players" wording={view.settings} notes={notes} />
      </section>

      {me?.alive ? <DoneTalking received={received} /> : null}

      <details className="card recap">
        <summary>What happened last night</summary>
        <p>{recap ?? "The narrator has nothing to add."}</p>
      </details>
    </div>
  );
}

/** "I'm done talking": a vote to end the discussion. When every player still in is done, voting starts. */
function DoneTalking({ received }: PhaseProps) {
  const { view } = received.payload;
  const action = useAction();
  const discussion = view.discussion;
  if (!discussion) return null;
  const done = discussion.youAreDone;
  const left = discussion.needed - discussion.doneCount;
  return (
    <section className="card done-talking">
      <button
        type="button"
        className={`btn btn-block${done ? " btn-ready-on" : ""}`}
        aria-pressed={done}
        disabled={action.pending}
        onClick={() =>
          void action.run(() => call("game:skipDiscussion", { skip: !done })).then((r) => {
            if (r.ok) haptic("tap");
          })
        }
      >
        <Icon name={done ? "check" : "fastForward"} />
        {done ? "You're done talking (tap to undo)" : "I'm done talking"}
      </button>
      <p className="field-hint center-text" role="status">
        {discussion.doneCount} of {discussion.needed} done talking.
        {left > 0 ? ` Voting starts early when everyone is.` : " Starting the vote…"}
      </p>
      <ErrorText error={action.error} />
    </section>
  );
}
