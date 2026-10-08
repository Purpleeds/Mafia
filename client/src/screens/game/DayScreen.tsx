import { Icon } from "../../art/icons";
import { PlayerGrid } from "../../components/PlayerGrid";
import { fill, isGangMember } from "../../lib/wording";
import { nameOf, type PhaseProps } from "./common";

/** Day discussion: who's still in, last night's news, and your private notes. The chat sits beside it. */
export function DayScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const you = view.you;
  const recap = view.narration?.kind === "night" && view.narration.status === "ready" ? view.narration.text : null;
  const alive = view.players.filter((p) => p.alive && !p.kicked).length;

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">{fill(`Day ${view.round}: who is {theGang}?`, view.settings)}</h2>
        <p className="field-hint">
          {alive} players are still in. Talk it over in the chat (or out loud). Voting starts when the timer ends.
        </p>
        <PlayerGrid players={view.players} youId={you?.id ?? null} label="Players" wording={view.settings} />
      </section>

      <details className="card recap">
        <summary>What happened last night</summary>
        <p>{recap ?? "The narrator has nothing to add."}</p>
      </details>

      {you && you.investigations.length > 0 ? (
        <section className="card" aria-label="Your investigation notes">
          <h2 className="card-title">
            <Icon name="search" size={20} />
            Your notes
          </h2>
          <ul className="notes">
            {you.investigations.map((i) => (
              <li key={`${i.round}-${i.targetId}`}>
                Night {i.round}: {nameOf(view, i.targetId)} is <strong>{isGangMember(i.isMafia, view.settings)}</strong>
              </li>
            ))}
          </ul>
          <p className="field-hint">Only you can see this.</p>
        </section>
      ) : null}
    </div>
  );
}
