import { useState } from "react";
import { Icon } from "../../art/icons";
import { NarratorCard } from "../../components/NarratorCard";
import { isGangMember } from "../../lib/wording";
import { nameOf, type PhaseProps } from "./common";
import { DeathCards, SaveNotice } from "./DeathCards";

/** The narrator announces the night; then who left, or the Doctor's save. */
export function NightResultsScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const [done, setDone] = useState(false);
  const found = view.you?.investigations.find((i) => i.round === view.round) ?? null;
  const report = view.nightReport;

  return (
    <div className="stack">
      <NarratorCard received={received} kind="night" onDone={() => setDone(true)} />
      {done ? (
        <>
          <DeathCards deaths={report?.deaths ?? []} view={view} moment={`night:${view.round}`} />
          {report?.saved ? <SaveNotice view={view} moment={`save:${view.round}`} /> : null}
          {found ? (
            <section className="card card-highlight" aria-label="Your investigation">
              <p className="card-lead">
                <Icon name="search" size={20} />
                {nameOf(view, found.targetId)} is{" "}
                {found.isMafia ? `${isGangMember(true, view.settings)}!` : `${isGangMember(false, view.settings)}.`}
              </p>
              <p className="field-hint">Only you can see this.</p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
