import type { ConnectionStatus, Phase, PublicPlayerView, SpectatorView } from "@mafia/shared";
import { CONNECTION_ICON, CONNECTION_LABEL, ROLE_LABEL } from "../lib/labels";
import { AvatarBadge } from "./AvatarBadge";
import { PlayerMenu } from "./PlayerMenu";

function ConnectionTag({ status }: { status: ConnectionStatus }) {
  return (
    <span className={`tag conn conn-${status}`}>
      <span aria-hidden="true">{CONNECTION_ICON[status]} </span>
      {CONNECTION_LABEL[status]}
    </span>
  );
}

interface PlayerListProps {
  players: PublicPlayerView[];
  youId: string | null;
  /** The viewer is the host (shows per-player actions). */
  viewerIsHost: boolean;
  phase: Phase;
}

function doneLabel(phase: Phase): string | null {
  if (phase === "ROLE_REVEAL") return "Ready";
  if (phase === "VOTING") return "Voted";
  return null;
}

export function PlayerList({ players, youId, viewerIsHost, phase }: PlayerListProps) {
  const inGame = phase !== "LOBBY";
  const done = doneLabel(phase);
  return (
    <ul className="player-list">
      {players.map((p) => {
        const isYou = p.id === youId;
        const out = inGame && (!p.alive || p.kicked);
        return (
          <li key={p.id} className={`player-row${out ? " is-out" : ""}${isYou ? " is-you" : ""}`}>
            <AvatarBadge avatar={p.avatar} size={44} />
            <div className="player-info">
              <div className="player-name">
                <span className="name-text">{p.name}</span>
                {isYou ? <span className="you-tag"> (you)</span> : null}
                {p.isHost ? (
                  <span className="host-tag" title="Host">
                    <span aria-hidden="true"> 👑</span>
                    <span className="sr-only"> host</span>
                  </span>
                ) : null}
              </div>
              <div className="player-tags">
                <ConnectionTag status={p.connection} />
                {inGame ? (
                  p.kicked ? (
                    <span className="tag tag-out">Removed by host</span>
                  ) : p.alive ? (
                    <span className="tag">Alive</span>
                  ) : (
                    <span className="tag tag-out">
                      <span aria-hidden="true">✝ </span>Eliminated
                    </span>
                  )
                ) : null}
                {p.role ? <span className="tag tag-role">{ROLE_LABEL[p.role]}</span> : null}
                {done && p.done && p.alive && !p.kicked ? (
                  <span className="tag tag-done">
                    <span aria-hidden="true">✓ </span>
                    {done}
                  </span>
                ) : null}
              </div>
            </div>
            {viewerIsHost && !isYou && !p.kicked ? (
              <PlayerMenu playerId={p.id} name={p.name} canMakeHost={p.connected} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface SpectatorListProps {
  spectators: SpectatorView[];
  youId: string | null;
  viewerIsHost: boolean;
}

export function SpectatorList({ spectators, youId, viewerIsHost }: SpectatorListProps) {
  if (spectators.length === 0) return null;
  return (
    <section className="card" aria-labelledby="spectators-title">
      <h2 id="spectators-title" className="card-title">
        Watching ({spectators.length})
      </h2>
      <ul className="player-list">
        {spectators.map((s) => {
          const isYou = s.id === youId;
          return (
            <li key={s.id} className={`player-row${isYou ? " is-you" : ""}`}>
              <AvatarBadge avatar={s.avatar} size={36} />
              <div className="player-info">
                <div className="player-name">
                  <span className="name-text">{s.name}</span>
                  {isYou ? <span className="you-tag"> (you)</span> : null}
                </div>
                <div className="player-tags">
                  <ConnectionTag status={s.connection} />
                  <span className="tag">Spectator</span>
                </div>
              </div>
              {viewerIsHost && !isYou ? <PlayerMenu playerId={s.id} name={s.name} canMakeHost={false} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
