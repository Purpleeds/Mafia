import { PlayerGrid } from "../../components/PlayerGrid";
import { nightNarration } from "../../lib/copy";
import { nameOf, type PhaseProps } from "./common";

/** Day discussion: who's still in, last night's news, and your private notes. The chat sits beside it. */
export function DayScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const mode = view.settings.contentMode;
  const you = view.you;
  const alive = view.players.filter((p) => p.alive && !p.kicked).length;

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">Day {view.round}: who is the Mafia?</h2>
        <p className="field-hint">
          {alive} players are still in. Talk it over in the chat (or out loud). Voting starts when the timer ends.
        </p>
        <PlayerGrid players={view.players} youId={you?.id ?? null} label="Players" />
      </section>

      <details className="card recap">
        <summary>What happened last night</summary>
        <p>{nightNarration(mode, view)}</p>
      </details>

      {you && you.investigations.length > 0 ? (
        <section className="card" aria-label="Your investigation notes">
          <h2 className="card-title">
            <span aria-hidden="true">🔍 </span>Your notes
          </h2>
          <ul className="notes">
            {you.investigations.map((i) => (
              <li key={`${i.round}-${i.targetId}`}>
                Night {i.round}: {nameOf(view, i.targetId)} is <strong>{i.isMafia ? "Mafia" : "not Mafia"}</strong>
              </li>
            ))}
          </ul>
          <p className="field-hint">Only you can see this.</p>
        </section>
      ) : null}
    </div>
  );
}
