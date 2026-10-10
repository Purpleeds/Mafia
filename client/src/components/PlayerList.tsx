import type { ConnectionStatus, Phase, PublicPlayerView, SpectatorView } from "@mafia/shared";
import { Icon } from "../art/icons";
import { CONNECTION_LABEL } from "../lib/labels";
import { AvatarBadge } from "./AvatarBadge";
import { BotTag } from "./BotTag";
import { PlayerMenu } from "./PlayerMenu";
import { OUTSIDE_A_ROOM, roleLabel, wordsFor, type WordingSettings } from "../lib/wording";

function ConnectionTag({ status }: { status: ConnectionStatus }) {
  return (
    <span className={`tag conn conn-${status}`}>
      <span className={`conn-dot conn-dot-${status}`} aria-hidden="true" />
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
  /** Players who just left the game: they fade out. */
  fadingIds?: readonly string[];
  /** The room's mode and gang name. */
  wording?: WordingSettings;
}

function doneLabel(phase: Phase): string | null {
  if (phase === "LOBBY" || phase === "ROLE_REVEAL") return "Ready";
  if (phase === "VOTING") return "Voted";
  return null;
}

export function PlayerList({ players, youId, viewerIsHost, phase, fadingIds = [], wording = OUTSIDE_A_ROOM }: PlayerListProps) {
  const inGame = phase !== "LOBBY";
  const done = doneLabel(phase);
  return (
    <ul className="player-list">
      {players.map((p) => {
        const isYou = p.id === youId;
        const out = inGame && (!p.alive || p.kicked);
        return (
          <li
            key={p.id}
            className={`player-row${out ? " is-out" : ""}${out && fadingIds.includes(p.id) ? " is-fading" : ""}${isYou ? " is-you" : ""}`}
          >
            <AvatarBadge avatar={p.avatar} size={44} />
            <div className="player-info">
              <div className="player-name">
                <span className="name-text">{p.name}</span>
                <BotTag player={p} />
                {isYou ? <span className="you-tag"> (you)</span> : null}
                {p.isHost ? (
                  <span className="host-tag" title="Host">
                    {" "}
                    <Icon name="crown" size={15} className="host-crown" />
                    <span className="sr-only"> host</span>
                  </span>
                ) : null}
              </div>
              <div className="player-tags">
                {p.isBot ? null : <ConnectionTag status={p.connection} />}
                {inGame ? (
                  p.kicked ? (
                    <span className="tag tag-out">Removed by host</span>
                  ) : p.alive ? (
                    <span className="tag">Alive</span>
                  ) : (
                    <span className="tag tag-out">
                      <Icon name={wordsFor(wording).outIcon} size={13} />
                      {wordsFor(wording).outTag}
                    </span>
                  )
                ) : null}
                {p.role ? <span className="tag tag-role">{roleLabel(p.role, wording)}</span> : null}
                {done && p.done && p.alive && !p.kicked ? (
                  <span className="tag tag-done">
                    <Icon name="check" size={13} />
                    {done}
                  </span>
                ) : null}
              </div>
            </div>
            {!isYou && !p.kicked && youId !== null ? (
              <PlayerMenu
                playerId={p.id}
                name={p.name}
                viewerIsHost={viewerIsHost}
                canMakeHost={p.connected && !p.isBot && !p.botPlaying}
                hasPhoto={!!p.avatar.photo}
              />
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
              {!isYou && youId !== null ? (
                <PlayerMenu playerId={s.id} name={s.name} viewerIsHost={viewerIsHost} canMakeHost={false} hasPhoto={!!s.avatar.photo} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
