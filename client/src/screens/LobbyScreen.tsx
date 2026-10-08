import { MAX_PLAYERS, MIN_PLAYERS } from "@mafia/shared";
import { InviteCard } from "../components/InviteCard";
import { LeaveRoomButton } from "../components/LeaveRoomButton";
import { PlayerList, SpectatorList } from "../components/PlayerList";
import { ProfileEditor } from "../components/ProfileEditor";
import { RoomHeader } from "../components/RoomHeader";
import { PasswordEditor, SettingsEditor } from "../components/SettingsEditor";
import { SettingsSummary } from "../components/SettingsSummary";
import { ErrorText } from "../components/ErrorText";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import type { ReceivedState } from "../state/store";

export function LobbyScreen({ received }: { received: ReceivedState }) {
  const { view, room } = received.payload;
  const you = view.you;
  const isHost = you?.isHost === true;
  const playerCount = view.players.length;
  const connectedCount = view.players.filter((p) => p.connected).length;
  const host = view.players.find((p) => p.id === view.hostId) ?? null;

  return (
    <div className="screen lobby">
      <RoomHeader code={room.code} hasPassword={room.hasPassword} large />

      {you?.isSpectator ? (
        <p className="info-banner" role="status">
          <span aria-hidden="true">👀 </span>The room is full, so you're watching. You'll get a seat when one frees up.
        </p>
      ) : null}

      <section className="card" aria-labelledby="players-title">
        <div className="card-header">
          <h2 id="players-title" className="card-title">
            Players
          </h2>
          <span className="count" aria-label={`${playerCount} of ${MAX_PLAYERS} players`}>
            {playerCount}/{MAX_PLAYERS}
          </span>
        </div>
        <PlayerList players={view.players} youId={you?.id ?? null} viewerIsHost={isHost} phase={view.phase} />
        {playerCount < MIN_PLAYERS ? (
          <p className="field-hint">
            Need at least {MIN_PLAYERS} players – invite {MIN_PLAYERS - playerCount} more.
          </p>
        ) : null}
      </section>

      <StartPanel isHost={isHost} connectedCount={connectedCount} hostName={host?.name ?? null} />

      <InviteCard code={room.code} hasPassword={room.hasPassword} />

      <SpectatorList spectators={view.spectators} youId={you?.id ?? null} viewerIsHost={isHost} />

      {you ? <ProfileEditor key={`${you.name}|${you.avatar.color}|${you.avatar.icon}`} name={you.name} avatar={you.avatar} /> : null}

      {isHost ? (
        <>
          <SettingsEditor settings={view.settings} playerCount={playerCount} />
          <PasswordEditor hasPassword={room.hasPassword} />
        </>
      ) : (
        <SettingsSummary settings={view.settings} playerCount={playerCount} />
      )}

      <LeaveRoomButton inGame={false} />
    </div>
  );
}

function StartPanel({
  isHost,
  connectedCount,
  hostName,
}: {
  isHost: boolean;
  connectedCount: number;
  hostName: string | null;
}) {
  const action = useAction();
  if (!isHost) {
    return (
      <section className="card center-block" role="status">
        <span className="spinner" aria-hidden="true" />
        <p className="card-lead">Waiting for {hostName ? `${hostName} (the host)` : "the host"} to start</p>
      </section>
    );
  }
  const reason =
    connectedCount < MIN_PLAYERS
      ? `Needs at least ${MIN_PLAYERS} connected players (${connectedCount} now).`
      : null;
  return (
    <section className="card">
      <button
        type="button"
        className="btn btn-primary btn-block btn-large"
        disabled={reason !== null || action.pending}
        aria-describedby="start-reason"
        onClick={() => void action.run(() => call("host:start", {}))}
      >
        {action.pending ? "Starting…" : "Start game"}
      </button>
      <p id="start-reason" className="field-hint center-text">
        {reason ?? "Everyone's here? Start when you're ready."}
      </p>
      <ErrorText error={action.error} />
    </section>
  );
}
