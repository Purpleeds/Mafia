import { useState } from "react";
import type { ContentMode } from "@mafia/shared";
import { Icon } from "../art/icons";
import { RoleIcon } from "../art/roles";
import { MODE_INFO } from "../lib/copy";
import { ROLE_INFO, ROLE_ORDER } from "../lib/roles";
import { OUTSIDE_A_ROOM, fill, gangOf, roleLabel, teamLabel, type WordingSettings } from "../lib/wording";

/**
 * The "How to play" text, shared by the page and the in-game help sheet. Inside
 * a room it follows the room's mode (Safe Mode never says "eliminate") and the
 * Mafia's name; on the how-to-play page it speaks Safe Mode.
 */
export function HowToPlayContent({ settings = OUTSIDE_A_ROOM }: { settings?: WordingSettings }) {
  const safe = settings.contentMode === "safe";
  const gang = gangOf(settings);
  return (
    <div className="prose stack">
      <section>
        <h2>The idea</h2>
        <p>
          A few people in the room are secretly the <strong>{gang}</strong>. Everyone else is the <strong>Town</strong>.
          The {gang} try to stay hidden and {safe ? "send the Town home" : "eliminate the Town"}. The Town try to work
          out who the {gang} are and vote them out. You need at least 5 players, and the game runs the narrator for
          you, so everyone gets to play.
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
            <strong>Discussion.</strong> Talk (and chat) about who seems suspicious.{" "}
            {safe
              ? "Players who have gone home can watch, but can't talk to the ones still playing."
              : "Eliminated players can watch, but can't talk to the living."}
          </li>
          <li>
            <strong>Vote.</strong> Tap a player to vote for them, or choose Skip. The player with the most votes is{" "}
            {safe ? "sent home" : "eliminated"}. If there's a tie, the host's setting decides: nobody goes, or the tied
            players get a revote.
          </li>
          <li>Then night falls again, until someone wins.</li>
        </ol>
      </section>
      <section>
        <h2>How to win</h2>
        <ul>
          <li>
            <strong>Town</strong> wins when every {gang} member is gone.
          </li>
          <li>
            <strong>{gang}</strong> win when they are as many as everyone else still in the game.
          </li>
          <li>
            The <strong>Jester</strong> (if the host turns them on) wins alone, immediately, if the town votes them
            out.
          </li>
        </ul>
      </section>
      <section>
        <h2>The narrator</h2>
        <p>
          The narrator announces what happened after every night and every vote. The host can switch on the{" "}
          <strong>AI narrator</strong>: an AI writes the announcement from public facts only (who left, and whether
          the Doctor saved someone). It never knows anyone's role, so it can't give anything away. If the AI is slow
          or isn't available, ready-made lines are used instead, so the game never waits for long.
        </p>
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
          The host picks one in the lobby, and it can't change once the game starts. Everyone sees which one is on.{" "}
          <strong>{MODE_INFO.safe.label}</strong> is {MODE_INFO.safe.blurb.toLowerCase()} Players who leave the game
          are simply sent home, and the chat filter is always on. <strong>{MODE_INFO.normal.label}</strong> is{" "}
          {MODE_INFO.normal.blurb.toLowerCase()} It has darker narration and a chat filter the host can turn off. The
          rules are exactly the same in both.
        </p>
      </section>
    </div>
  );
}

/**
 * Every role, in the tone of the chosen mode. On the role-guide page you can
 * flip between the two wordings; inside a game (`lockMode`) it only ever shows
 * the room's own mode, so a Safe Mode player can't read Normal Mode's words.
 */
export function RoleGuideContent({
  initialMode = "safe",
  settings = OUTSIDE_A_ROOM,
  lockMode = false,
}: {
  initialMode?: ContentMode;
  settings?: WordingSettings;
  lockMode?: boolean;
}) {
  const [picked, setMode] = useState<ContentMode>(initialMode);
  const mode = lockMode ? initialMode : picked;
  // The guide shows either mode's wording; the Mafia's new name only applies in Safe Mode.
  const wording: WordingSettings = { contentMode: mode, sneakyGang: settings.sneakyGang };
  return (
    <div className="stack">
      {lockMode ? null : (
        <div className="segmented" role="group" aria-label="Wording">
          {(["safe", "normal"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`segment${m === mode ? " is-selected" : ""}`}
              aria-pressed={m === mode}
              onClick={() => setMode(m)}
            >
              <Icon name={MODE_INFO[m].icon} size={16} />
              {MODE_INFO[m].label}
            </button>
          ))}
        </div>
      )}
      <ul className="role-guide">
        {ROLE_ORDER.map((role) => {
          const info = ROLE_INFO[role];
          return (
            <li key={role} className="card role-entry">
              <div className="role-entry-head">
                <RoleIcon role={role} size={52} className="role-entry-icon" />
                <div>
                  <h3 className="card-title">{roleLabel(role, wording)}</h3>
                  <div className="player-tags">
                    <span className="tag">{teamLabel(info.team, wording)}</span>
                    {info.optional ? <span className="tag">Optional role</span> : null}
                  </div>
                </div>
              </div>
              <p>{fill(info.summary[mode], wording)}</p>
              <p>
                <strong>Power:</strong> {fill(info.ability[mode], wording)}
              </p>
              <p>
                <strong>Goal:</strong> {fill(info.goal, wording)}
              </p>
              <p className="field-hint">
                <Icon name="bulb" size={15} /> {fill(info.tip[mode], wording)}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
