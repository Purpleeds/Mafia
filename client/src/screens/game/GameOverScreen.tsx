import type { GameView, TimelineEntry } from "@mafia/shared";
import { AvatarBadge } from "../../components/AvatarBadge";
import { ErrorText } from "../../components/ErrorText";
import { NIGHT_OUTCOME_LABEL, ROLE_LABEL, WINNER_EMOJI, WINNER_LABEL } from "../../lib/labels";
import { ROLE_INFO } from "../../lib/roles";
import { useAction } from "../../lib/useAction";
import { call } from "../../net/socket";
import { nameOf, type PhaseProps } from "./common";

const WINNER_LINE = {
  safe: {
    town: "The town found every Mafia member. Hooray!",
    mafia: "The Mafia took over the town!",
    jester: "The Jester tricked everyone! 🎉",
  },
  normal: {
    town: "The last Mafia member is gone. The town is safe… for now.",
    mafia: "The Mafia now own this town.",
    jester: "The Jester fooled the whole town into voting them out.",
  },
} as const;

export function GameOverScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const action = useAction();
  const isHost = view.you?.isHost === true;
  const winner = view.winner;
  const mode = view.settings.contentMode;
  const winners = new Set(view.winnerIds);
  const players = [...view.players].sort((a, b) => Number(winners.has(b.id)) - Number(winners.has(a.id)));

  return (
    <div className="stack">
      <section className="card card-highlight center-block winner-card" aria-labelledby="winner-title">
        <span className="winner-emoji" aria-hidden="true">
          {winner ? WINNER_EMOJI[winner] : "🏁"}
        </span>
        <h2 id="winner-title" className="winner">
          {winner ? WINNER_LABEL[winner] : "Game over"}
        </h2>
        {winner ? <p className="card-lead">{WINNER_LINE[mode][winner]}</p> : null}
        {isHost ? (
          <button
            type="button"
            className="btn btn-primary btn-block btn-large"
            disabled={action.pending}
            onClick={() => void action.run(() => call("host:restart", {}))}
          >
            {action.pending ? "Starting…" : "Play Again"}
          </button>
        ) : (
          <p className="field-hint" role="status">
            <span className="spinner" aria-hidden="true" /> Waiting for the host to play again…
          </p>
        )}
        <ErrorText error={action.error} />
      </section>

      <section className="card" aria-labelledby="roles-title">
        <h2 id="roles-title" className="card-title">
          Everyone's roles
        </h2>
        <ul className="player-list">
          {players.map((p) => (
            <li key={p.id} className={`player-row${p.alive ? "" : " is-out"}${p.id === view.you?.id ? " is-you" : ""}`}>
              <AvatarBadge avatar={p.avatar} size={44} />
              <div className="player-info">
                <div className="player-name">
                  <span className="name-text">{p.name}</span>
                  {p.id === view.you?.id ? <span className="you-tag"> (you)</span> : null}
                  {winners.has(p.id) ? (
                    <span title="Winner">
                      <span aria-hidden="true"> 🏆</span>
                      <span className="sr-only"> winner</span>
                    </span>
                  ) : null}
                </div>
                <div className="player-tags">
                  {p.role ? (
                    <span className="tag tag-role">
                      <span aria-hidden="true">{ROLE_INFO[p.role].emoji} </span>
                      {ROLE_LABEL[p.role]}
                    </span>
                  ) : null}
                  <span className={`tag${p.alive ? "" : " tag-out"}`}>{p.kicked ? "Removed" : p.alive ? "Survived" : "Eliminated"}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {view.you?.loverIds ? (
          <p className="field-hint">
            <span aria-hidden="true">💘 </span>Lovers: {view.you.loverIds.map((id) => nameOf(view, id)).join(" & ")}
          </p>
        ) : null}
      </section>

      <Timeline view={view} />
    </div>
  );
}

function deathText(view: GameView, d: TimelineEntry["night"]["deaths"][number]): string {
  const who = nameOf(view, d.playerId);
  const role = d.role ? ` (${ROLE_LABEL[d.role]})` : "";
  if (d.cause === "heartbreak") return `${who}${role} died of a broken heart.`;
  if (d.cause === "vote") return `${who}${role} was voted out.`;
  return `${who}${role} was eliminated by the Mafia.`;
}

export function Timeline({ view }: { view: GameView }) {
  if (view.timeline.length === 0) return null;
  return (
    <section className="card" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="card-title">
        What happened
      </h2>
      <ol className="timeline">
        {view.timeline.map((entry) => {
          const n = entry.night;
          const name = (id: string) => nameOf(view, id);
          return (
            <li key={entry.round} className="timeline-round">
              <h3 className="timeline-title">
                <span aria-hidden="true">🌙 </span>Night {entry.round}
              </h3>
              <ul className="timeline-events">
                {n.linkedIds ? (
                  <li>
                    💘 Cupid linked {name(n.linkedIds[0])} and {name(n.linkedIds[1])}.
                  </li>
                ) : null}
                <li>
                  🕶️{" "}
                  {n.mafiaTargetId
                    ? `The Mafia went after ${name(n.mafiaTargetId)}. ${NIGHT_OUTCOME_LABEL[n.outcome]}`
                    : NIGHT_OUTCOME_LABEL.no_attack}
                </li>
                {n.protectedId ? <li>🩺 The Doctor protected {name(n.protectedId)}.</li> : null}
                {n.guardedId ? <li>🛡️ The Bodyguard guarded {name(n.guardedId)}.</li> : null}
                {n.investigation ? (
                  <li>
                    🔍 The Detective checked {name(n.investigation.targetId)}:{" "}
                    {n.investigation.isMafia ? "Mafia" : "not Mafia"}.
                  </li>
                ) : null}
                {n.deaths.map((d) => (
                  <li key={d.playerId}>💀 {deathText(view, d)}</li>
                ))}
                {n.deaths.length === 0 ? <li>☀️ Everyone woke up.</li> : null}
              </ul>
              {entry.vote ? (
                <>
                  <h3 className="timeline-title">
                    <span aria-hidden="true">🗳 </span>Day {entry.round} vote
                  </h3>
                  <ul className="timeline-events">
                    {entry.vote.outcome === "eliminated" ? (
                      entry.vote.deaths.map((d) => <li key={d.playerId}>💀 {deathText(view, d)}</li>)
                    ) : (
                      <li>
                        {entry.vote.outcome === "skipped"
                          ? "The town skipped. Nobody was voted out."
                          : entry.vote.outcome === "tie"
                            ? "The vote was tied. Nobody was voted out."
                            : "Nobody voted."}
                      </li>
                    )}
                  </ul>
                </>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
