import { useState } from "react";
import { Icon } from "../../art/icons";
import { Typewriter } from "../../components/Typewriter";
import { nightNarration } from "../../lib/copy";
import { DeathCards, SaveNotice } from "./DeathCards";
import { nameOf, typingSpeed, type PhaseProps } from "./common";

/** The narrator announces the night, typewriter style; then who left, or the Doctor's save. */
export function NightResultsScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const mode = view.settings.contentMode;
  const text = nightNarration(mode, view);
  const [done, setDone] = useState(false);
  const [speed] = useState(() => typingSpeed(received, text.length));
  const found = view.you?.investigations.find((i) => i.round === view.round) ?? null;
  const report = view.nightReport;
  const moment = `${view.round}:${view.phaseEndsAt ?? ""}`;

  return (
    <div className="stack">
      <section className="card narrator" aria-label="The narrator">
        <p className="eyebrow">
          <Icon name="mic" size={15} />
          The narrator
        </p>
        <Typewriter text={text} speed={speed} onDone={() => setDone(true)} />
      </section>
      {done ? (
        <>
          <DeathCards deaths={report?.deaths ?? []} view={view} moment={`night:${moment}`} />
          {report?.saved ? <SaveNotice view={view} moment={`save:${moment}`} /> : null}
          {found ? (
            <section className="card card-highlight" aria-label="Your investigation">
              <p className="card-lead">
                <Icon name="search" size={20} />
                {nameOf(view, found.targetId)} is {found.isMafia ? "Mafia!" : "not Mafia."}
              </p>
              <p className="field-hint">Only you can see this.</p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
