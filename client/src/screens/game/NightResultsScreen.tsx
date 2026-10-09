import { useState } from "react";
import { NarratorCard } from "../../components/NarratorCard";
import { NightNoteCard } from "../../components/PrivateCards";
import type { PhaseProps } from "./common";
import { DeathCards, SaveNotice } from "./DeathCards";

/** The narrator announces the night; then who left, or the Doctor's save. */
export function NightResultsScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const [done, setDone] = useState(false);
  const report = view.nightReport;

  return (
    <div className="stack">
      <NarratorCard received={received} kind="night" onDone={() => setDone(true)} />
      {done ? (
        <>
          <DeathCards deaths={report?.deaths ?? []} view={view} moment={`night:${view.round}`} />
          {report?.saved ? <SaveNotice view={view} moment={`save:${view.round}`} /> : null}
        </>
      ) : null}
      {/* Everyone's note appears at the same moment, closed, whatever their role. */}
      <NightNoteCard view={view} />
    </div>
  );
}
