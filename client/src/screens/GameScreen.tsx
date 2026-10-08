import type { GameView, PublicPlayerView } from "@mafia/shared";
import { AvatarBadge } from "../components/AvatarBadge";
import { Countdown } from "../components/Countdown";
import { ErrorText } from "../components/ErrorText";
import { LeaveRoomButton } from "../components/LeaveRoomButton";
import { PlayerList, SpectatorList } from "../components/PlayerList";
import { RoomHeader } from "../components/RoomHeader";
import { PHASE_LABEL, ROLE_LABEL, WINNER_LABEL } from "../lib/labels";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import type { ReceivedState } from "../state/store";

/** Placeholder for the real game screens (a later step): phase, timer, your role and the players. */
export function GameScreen({ received }: { received: ReceivedState }) {
  const { view, room, serverNow } = received.payload;
  const you = view.you;
  const isHost = you?.isHost === true;
  const me = you ? (view.players.find((p) => p.id === you.id) ?? null) : null;

  return (
    <div className="screen game">
      <RoomHeader code={room.code} hasPassword={room.hasPassword}>
        <div className="phase-bar">
          <span className="phase-name">{PHASE_LABEL[view.phase]}</span>
          {view.round > 0 ? <span className="tag">Round {view.round}</span> : null}
          <Countdown endsAt={view.phaseEndsAt} serverNow={serverNow} receivedAt={received.receivedAt} />
        </div>
      </RoomHeader>

      {you?.isSpectator || !me ? (
        <p className="info-banner" role="status">
          <span aria-hidden="true">👀 </span>You're watching – you'll join the next game.
        </p>
      ) : null}

      {view.phase === "GAME_OVER" ? <GameOverCard view={view} isHost={isHost} /> : null}

      {you && me && you.role ? <RoleCard view={view} me={me} /> : null}

      <section className="card" aria-labelledby="game-players-title">
        <h2 id="game-players-title" className="card-title">
          Players
        </h2>
        <PlayerList players={view.players} youId={you?.id ?? null} viewerIsHost={isHost} phase={view.phase} />
      </section>

      <SpectatorList spectators={view.spectators} youId={you?.id ?? null} viewerIsHost={isHost} />

      <LeaveRoomButton inGame={view.phase !== "GAME_OVER" && !you?.isSpectator} />
    </div>
  );
}

function nameOf(view: GameView, id: string): string {
  return view.players.find((p) => p.id === id)?.name ?? "Someone";
}

function RoleCard({ view, me }: { view: GameView; me: PublicPlayerView }) {
  const action = useAction();
  const you = view.you;
  if (!you?.role) return null;
  const needsAck = view.phase === "ROLE_REVEAL" && !me.done && me.alive;
  const players = view.players.filter((p) => p.alive && !p.kicked);
  const ready = players.filter((p) => p.done).length;

  return (
    <section className="card role-card" aria-labelledby="role-title">
      <p className="eyebrow">Your role</p>
      <h2 id="role-title" className="role-name">
        {ROLE_LABEL[you.role]}
      </h2>
      {!you.alive ? <p className="tag tag-out">You've been eliminated</p> : null}
      {you.teammateIds.length > 0 ? (
        <p>Your fellow Mafia: {you.teammateIds.map((id) => nameOf(view, id)).join(", ")}</p>
      ) : null}
      {you.loverIds ? <p>Lovers: {you.loverIds.map((id) => nameOf(view, id)).join(" & ")}</p> : null}
      {view.phase === "ROLE_REVEAL" ? (
        needsAck ? (
          <button
            type="button"
            className="btn btn-primary btn-block btn-large"
            disabled={action.pending}
            onClick={() => void action.run(() => call("game:ackRole", {}))}
          >
            Got it
          </button>
        ) : (
          <p className="field-hint" role="status">
            Waiting for everyone ({ready}/{players.length} ready)…
          </p>
        )
      ) : null}
      <ErrorText error={action.error} />
    </section>
  );
}

function GameOverCard({ view, isHost }: { view: GameView; isHost: boolean }) {
  const action = useAction();
  const winners = view.players.filter((p) => view.winnerIds.includes(p.id));
  return (
    <section className="card card-highlight center-block" aria-labelledby="winner-title">
      <h2 id="winner-title" className="winner">
        {view.winner ? WINNER_LABEL[view.winner] : "Game over"}
      </h2>
      {winners.length > 0 ? (
        <ul className="winner-list">
          {winners.map((p) => (
            <li key={p.id}>
              <AvatarBadge avatar={p.avatar} size={28} /> {p.name}
              {p.role ? ` – ${ROLE_LABEL[p.role]}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {isHost ? (
        <button
          type="button"
          className="btn btn-primary btn-block btn-large"
          disabled={action.pending}
          onClick={() => void action.run(() => call("host:restart", {}))}
        >
          Back to lobby
        </button>
      ) : (
        <p className="field-hint">Waiting for the host to start a new round.</p>
      )}
      <ErrorText error={action.error} />
    </section>
  );
}
