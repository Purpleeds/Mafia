import { useState } from "react";
import type { DeathView } from "@mafia/shared";
import { AvatarBadge } from "../../components/AvatarBadge";
import { Typewriter } from "../../components/Typewriter";
import { nightNarration } from "../../lib/copy";
import { ROLE_LABEL } from "../../lib/labels";
import { nameOf, typingSpeed, type PhaseProps } from "./common";

export function DeathCards({ deaths, view }: { deaths: DeathView[]; view: PhaseProps["received"]["payload"]["view"] }) {
  const mode = view.settings.contentMode;
  if (deaths.length === 0) return null;
  return (
    <ul className="death-list" aria-label="Who was eliminated">
      {deaths.map((d) => {
        const player = view.players.find((p) => p.id === d.playerId);
        return (
          <li key={d.playerId} className="death-card">
            {player ? <AvatarBadge avatar={player.avatar} size={56} /> : null}
            <div>
              <p className="death-name">{nameOf(view, d.playerId)}</p>
              <p className="field-hint">
                {d.cause === "heartbreak"
                  ? "💔 Broken heart"
                  : d.cause === "vote"
                    ? mode === "safe"
                      ? "🗳 Sent home by the town"
                      : "🗳 Voted out"
                    : mode === "safe"
                      ? "🌙 Sent home by the Mafia"
                      : "🌙 Killed in the night"}
                {d.role ? ` · ${ROLE_LABEL[d.role]}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The narrator announces the night, typewriter style. */
export function NightResultsScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const mode = view.settings.contentMode;
  const text = nightNarration(mode, view);
  const [done, setDone] = useState(false);
  const [speed] = useState(() => typingSpeed(received, text.length));
  const found = view.you?.investigations.find((i) => i.round === view.round) ?? null;

  return (
    <div className="stack">
      <section className="card narrator" aria-label="The narrator">
        <p className="eyebrow">
          <span aria-hidden="true">🎙 </span>The narrator
        </p>
        <Typewriter text={text} speed={speed} onDone={() => setDone(true)} />
      </section>
      {done ? (
        <>
          <DeathCards deaths={view.nightReport?.deaths ?? []} view={view} />
          {found ? (
            <section className="card card-highlight" aria-label="Your investigation">
              <p className="card-lead">
                <span aria-hidden="true">🔍 </span>
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
