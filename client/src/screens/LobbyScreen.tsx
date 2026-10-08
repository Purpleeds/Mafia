import { useState, type ReactNode } from "react";
import { MAX_PLAYERS, MIN_PLAYERS } from "@mafia/shared";
import { Icon } from "../art/icons";
import { ErrorText } from "../components/ErrorText";
import { HelpSheet } from "../components/HelpSheet";
import { InviteCard } from "../components/InviteCard";
import { LeaveRoomButton } from "../components/LeaveRoomButton";
import { PlayerList, SpectatorList } from "../components/PlayerList";
import { ProfileEditor } from "../components/ProfileEditor";
import { RoomHeader } from "../components/RoomHeader";
import { DevBotsCard } from "../components/DevTools";
import { PasswordEditor, SettingsEditor } from "../components/SettingsEditor";
import { SettingsSummary } from "../components/SettingsSummary";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import type { ReceivedState } from "../state/store";

/** A lobby block; `order` sets its place in the single mobile column (the two-column laptop layout keeps it). */
function Block({ order, children }: { order: number; children: ReactNode }) {
  return (
    <div className="lobby-item" style={{ order }}>
      {children}
    </div>
  );
}

export function LobbyScreen({ received }: { received: ReceivedState }) {
  const { view, room } = received.payload;
  const [helpOpen, setHelpOpen] = useState(false);
  const you = view.you;
  const isHost = you?.isHost === true;
  const playerCount = view.players.length;
  const connectedCount = view.players.filter((p) => p.connected).length;
  const host = view.players.find((p) => p.id === view.hostId) ?? null;

  return (
    <div className="screen screen-wide lobby">
      <RoomHeader code={room.code} hasPassword={room.hasPassword} large mode={view.settings.contentMode} />

      {you?.isSpectator ? (
        <p className="info-banner" role="status">
          <Icon name="eye" />
          The room is full, so you're watching. You'll get a seat when one frees up.
        </p>
      ) : null}

      <div className="lobby-grid">
        <div className="lobby-col">
          <Block order={1}>
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
          </Block>

          <Block order={2}>
            <StartPanel isHost={isHost} connectedCount={connectedCount} hostName={host?.name ?? null} />
          </Block>

          <Block order={4}>
            <SpectatorList spectators={view.spectators} youId={you?.id ?? null} viewerIsHost={isHost} />
          </Block>

          <Block order={5}>
            {you ? (
              <ProfileEditor
                key={`${you.name}|${you.avatar.color}|${you.avatar.seed}`}
                name={you.name}
                avatar={you.avatar}
              />
            ) : null}
          </Block>
        </div>

        <div className="lobby-col">
          <Block order={3}>
            <InviteCard code={room.code} hasPassword={room.hasPassword} />
          </Block>

          <Block order={6}>
            {isHost ? (
              <>
                <SettingsEditor settings={view.settings} playerCount={playerCount} />
                <PasswordEditor hasPassword={room.hasPassword} />
                <DevBotsCard playerCount={playerCount} />
              </>
            ) : (
              <SettingsSummary settings={view.settings} playerCount={playerCount} />
            )}
          </Block>
        </div>
      </div>

      <div className="lobby-footer">
        <button type="button" className="btn btn-block" onClick={() => setHelpOpen(true)}>
          How to play and role guide
        </button>
        <LeaveRoomButton inGame={false} />
      </div>
      {helpOpen ? <HelpSheet settings={view.settings} onClose={() => setHelpOpen(false)} /> : null}
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
