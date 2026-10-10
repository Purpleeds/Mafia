import { useState, type ReactNode } from "react";
import { MAX_PLAYERS, MIN_HUMANS, MIN_PLAYERS, effectiveChatFilter, type GameView } from "@mafia/shared";
import { Icon } from "../art/icons";
import { UncensoredNotice } from "../components/ChatNotices";
import { ErrorText } from "../components/ErrorText";
import { BotsCard } from "../components/BotsCard";
import { AvatarRequests } from "../components/PhotoControls";
import { PhaseHint } from "../components/PhaseHint";
import { HelpSheet } from "../components/HelpSheet";
import { InviteCard } from "../components/InviteCard";
import { LeaveRoomButton } from "../components/LeaveRoomButton";
import { PlayerList, SpectatorList } from "../components/PlayerList";
import { ProfileEditor } from "../components/ProfileEditor";
import { RoomHeader } from "../components/RoomHeader";
import { PasswordEditor, SettingsEditor } from "../components/SettingsEditor";
import { SettingsSummary } from "../components/SettingsSummary";
import { haptic } from "../lib/haptics";
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
      {effectiveChatFilter(view.settings) === "uncensored" ? <UncensoredNotice lobby /> : null}
      <PhaseHint id="lobby" />

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
                  Need at least {MIN_PLAYERS} players – invite {MIN_PLAYERS - playerCount} more
                  {isHost ? ", or add bots below." : "."}
                </p>
              ) : null}
            </section>
          </Block>

          <Block order={2}>
            <StartPanel view={view} isHost={isHost} connectedCount={connectedCount} hostName={host?.name ?? null} />
          </Block>

          {isHost ? (
            <Block order={2}>
              <AvatarRequests view={view} />
            </Block>
          ) : null}

          {isHost ? (
            <Block order={2}>
              <BotsCard view={view} />
            </Block>
          ) : null}

          <Block order={4}>
            <SpectatorList spectators={view.spectators} youId={you?.id ?? null} viewerIsHost={isHost} />
          </Block>

          <Block order={5}>
            {you ? (
              <ProfileEditor
                key={`${you.name}|${you.avatar.color}|${you.avatar.seed}`}
                name={you.name}
                avatar={you.avatar}
                view={view}
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
              </>
            ) : (
              <SettingsSummary
                settings={view.settings}
                playerCount={playerCount}
                botCount={view.players.filter((p) => p.isBot).length}
              />
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

/** Ready to play: everyone but the host taps Ready; the host's Start button lights up once they all have. */
function StartPanel({
  view,
  isHost,
  connectedCount,
  hostName,
}: {
  view: GameView;
  isHost: boolean;
  connectedCount: number;
  hostName: string | null;
}) {
  const action = useAction();
  const me = view.players.find((p) => p.id === view.you?.id) ?? null;
  const others = view.players.filter((p) => p.connected && p.id !== view.hostId);
  const readyCount = others.filter((p) => p.done).length;
  const allReady = others.length > 0 && readyCount === others.length;
  const readyLine = others.length === 0 ? "" : `${readyCount} of ${others.length} players ready.`;

  if (!isHost) {
    if (!me) {
      return (
        <section className="card center-block" role="status">
          <p className="card-lead">Waiting for {hostName ? `${hostName} (the host)` : "the host"} to start</p>
        </section>
      );
    }
    return (
      <section className="card center-block">
        <button
          type="button"
          className={`btn btn-block btn-large${me.done ? " btn-ready-on" : " btn-primary"}`}
          aria-pressed={me.done}
          disabled={action.pending}
          onClick={() =>
            void action.run(() => call("player:setReady", { ready: !me.done })).then((r) => {
              if (r.ok) haptic("tap");
            })
          }
        >
          <Icon name={me.done ? "check" : "ready"} />
          {me.done ? "You're ready (tap to undo)" : "I'm ready"}
        </button>
        <p className="field-hint center-text" role="status">
          {readyLine} {hostName ? `${hostName} (the host)` : "The host"} starts the game.
        </p>
        <ErrorText error={action.error} />
      </section>
    );
  }
  const people = view.players.filter((p) => !p.isBot).length;
  const reason =
    connectedCount < MIN_PLAYERS
      ? `Needs at least ${MIN_PLAYERS} connected players (${connectedCount} now). Invite friends or add bots.`
      : people < MIN_HUMANS && !view.settings.soloPractice
        ? `Needs at least ${MIN_HUMANS} real players. Turn on solo practice in Bots to play with just bots.`
        : null;
  const glow = reason === null && allReady;
  return (
    <section className={`card${glow ? " card-ready" : ""}`}>
      <button
        type="button"
        className={`btn btn-primary btn-block btn-large${glow ? " is-everyone-ready" : ""}`}
        disabled={reason !== null || action.pending}
        aria-describedby="start-reason"
        onClick={() => void action.run(() => call("host:start", {}))}
      >
        {action.pending ? "Starting…" : glow ? "Everyone's ready: Start game" : "Start game"}
      </button>
      <p id="start-reason" className="field-hint center-text" role="status">
        {reason ?? (glow ? "Everyone has tapped Ready." : `${readyLine} You can start without waiting.`)}
      </p>
      <ErrorText error={action.error} />
    </section>
  );
}
