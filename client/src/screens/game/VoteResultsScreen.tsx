import { useState } from "react";
import { SKIP } from "@mafia/shared";
import { AvatarBadge } from "../../components/AvatarBadge";
import { NarratorCard } from "../../components/NarratorCard";
import { DeathCards } from "./DeathCards";
import { nameOf, type PhaseProps } from "./common";

export function VoteResultsScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const report = view.voteReport;
  const [done, setDone] = useState(false);

  const rows = report
    ? Object.entries(report.tally)
        .map(([option, count]) => ({ option, count }))
        .sort((a, b) => b.count - a.count)
    : [];
  const max = rows[0]?.count ?? 1;
  const ballotEntries = report ? Object.entries(report.ballots) : [];

  return (
    <div className="stack">
      <NarratorCard received={received} kind="vote" onDone={() => setDone(true)} />
      {done && report ? (
        <>
          <DeathCards deaths={report.deaths} view={view} moment={`vote:${view.round}`} />
          <section className="card" aria-label="Vote counts">
            <h2 className="card-title">The vote</h2>
            <ul className="tally">
              {rows.map(({ option, count }) => {
                const label = option === SKIP ? "Skip" : nameOf(view, option);
                const voters = ballotEntries.filter(([, t]) => t === option).map(([id]) => view.players.find((p) => p.id === id));
                return (
                  <li key={option} className="tally-row">
                    <div className="tally-head">
                      <span className="tally-name">{label}</span>
                      <span className="count">{count}</span>
                    </div>
                    <div className="tally-bar" aria-hidden="true">
                      <span style={{ width: `${Math.round((count / max) * 100)}%` }} />
                    </div>
                    {voters.length > 0 ? (
                      <div className="voter-row">
                        {voters.map((v) =>
                          v ? <AvatarBadge key={v.id} avatar={v.avatar} size={24} label={`${v.name}${v.isBot ? " (Bot)" : ""} voted ${label}`} /> : null,
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="field-hint">Players who didn't vote count as Skip.</p>
          </section>
        </>
      ) : null}
    </div>
  );
}
