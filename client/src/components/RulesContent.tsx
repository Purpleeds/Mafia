import { useState } from "react";
import type { ContentMode } from "@mafia/shared";
import { MODE_INFO } from "../lib/copy";
import { ROLE_INFO, ROLE_ORDER, TEAM_LABEL } from "../lib/roles";
import { ROLE_LABEL } from "../lib/labels";

/** The "How to play" text, shared by the page and the in-game help sheet. */
export function HowToPlayContent() {
  return (
    <div className="prose stack">
      <section>
        <h2>The idea</h2>
        <p>
          A few people in the room are secretly the <strong>Mafia</strong>. Everyone else is the <strong>Town</strong>.
          The Mafia try to stay hidden and eliminate the Town. The Town try to work out who the Mafia are and vote them
          out. You need at least 5 players, and the game runs the narrator for you, so everyone gets to play.
        </p>
      </section>
      <section>
        <h2>A round</h2>
        <ol>
          <li>
            <strong>Role reveal.</strong> Tap your card to see your secret role. Tap again to hide it before anyone
            peeks!
          </li>
          <li>
            <strong>Night.</strong> Everyone's screen goes dark. Players with a night power pick someone. Everyone
            else sees a pretend grid too, so nobody can tell who has a role.
          </li>
          <li>
            <strong>Morning.</strong> The narrator tells the town what happened overnight.
          </li>
          <li>
            <strong>Discussion.</strong> Talk (and chat) about who seems suspicious. Eliminated players can watch, but
            can't talk to the living.
          </li>
          <li>
            <strong>Vote.</strong> Tap a player to vote for them, or choose Skip. The player with the most votes is
            eliminated. If there's a tie, the host's setting decides: nobody goes, or the tied players get a revote.
          </li>
          <li>Then night falls again, until someone wins.</li>
        </ol>
      </section>
      <section>
        <h2>How to win</h2>
        <ul>
          <li>
            <strong>Town</strong> wins when every Mafia member is gone.
          </li>
          <li>
            <strong>Mafia</strong> wins when they are as many as everyone else still in the game.
          </li>
          <li>
            The <strong>Jester</strong> (if the host turns them on) wins alone, immediately, if the town votes them
            out.
          </li>
        </ul>
      </section>
      <section>
        <h2>Tips</h2>
        <ul>
          <li>Keep your phone turned away from your neighbours, especially when you look at your role.</li>
          <li>Lying is part of the game. Accusing people and defending yourself is too.</li>
          <li>If your connection drops, just reopen the page. You'll be back in your seat with the same role.</li>
          <li>Joined late? You'll watch this game and play in the next one.</li>
        </ul>
      </section>
      <section>
        <h2>Safe Mode and Normal Mode</h2>
        <p>
          The host picks one. <strong>{MODE_INFO.safe.label}</strong> is {MODE_INFO.safe.blurb.toLowerCase()}{" "}
          <strong>{MODE_INFO.normal.label}</strong> is {MODE_INFO.normal.blurb.toLowerCase()} The rules are exactly the
          same in both.
        </p>
      </section>
    </div>
  );
}

/** Every role, in the tone of the chosen mode. */
export function RoleGuideContent({ initialMode = "safe" }: { initialMode?: ContentMode }) {
  const [mode, setMode] = useState<ContentMode>(initialMode);
  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Wording">
        {(["safe", "normal"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`segment${m === mode ? " is-selected" : ""}`}
            aria-pressed={m === mode}
            onClick={() => setMode(m)}
          >
            {MODE_INFO[m].emoji} {MODE_INFO[m].label}
          </button>
        ))}
      </div>
      <ul className="role-guide">
        {ROLE_ORDER.map((role) => {
          const info = ROLE_INFO[role];
          return (
            <li key={role} className="card role-entry">
              <div className="role-entry-head">
                <span className="role-entry-emoji" aria-hidden="true">
                  {info.emoji}
                </span>
                <div>
                  <h3 className="card-title">{ROLE_LABEL[role]}</h3>
                  <div className="player-tags">
                    <span className="tag">{TEAM_LABEL[info.team]}</span>
                    {info.optional ? <span className="tag">Optional role</span> : null}
                  </div>
                </div>
              </div>
              <p>{info.summary[mode]}</p>
              <p>
                <strong>Power:</strong> {info.ability[mode]}
              </p>
              <p>
                <strong>Goal:</strong> {info.goal}
              </p>
              <p className="field-hint">💡 {info.tip}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
