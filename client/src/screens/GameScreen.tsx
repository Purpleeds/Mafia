import { useEffect, useRef, useState } from "react";
import { Icon } from "../art/icons";
import { ChatPanel } from "../components/ChatPanel";
import { EventLog, describeLogEntry } from "../components/EventLog";
import { GameTopBar } from "../components/GameTopBar";
import { NotesPanel } from "../components/NotesPanel";
import { PhaseHint } from "../components/PhaseHint";
import { MyRoleCard } from "../components/PrivateCards";
import { hintFor } from "../lib/hints";
import { clearNotes } from "../lib/notes";
import { usePrefs } from "../lib/prefs";
import { useWakeLock } from "../lib/wakeLock";
import { showToast } from "../state/store";
import { HelpSheet } from "../components/HelpSheet";
import { LeaveRoomButton } from "../components/LeaveRoomButton";
import { PlayerList, SpectatorList } from "../components/PlayerList";
import type { ReceivedState } from "../state/store";
import { DayScreen } from "./game/DayScreen";
import { GameOverScreen } from "./game/GameOverScreen";
import { NightResultsScreen } from "./game/NightResultsScreen";
import { NightScreen } from "./game/NightScreen";
import { RoleRevealScreen } from "./game/RoleRevealScreen";
import { VoteResultsScreen } from "./game/VoteResultsScreen";
import { VotingScreen } from "./game/VotingScreen";
import { myPlayer } from "./game/common";
import { wordsFor } from "../lib/wording";

/** Every in-game phase: a status bar, the phase's screen, and a side column (chat and players) where it helps. */
export function GameScreen({ received }: { received: ReceivedState }) {
  const { view } = received.payload;
  const [helpOpen, setHelpOpen] = useState(false);
  const you = view.you;
  const me = myPlayer(view);
  const watching = !!you?.isSpectator || !me;
  const out = !!me && !me.alive;

  const prefs = usePrefs();
  const roomCode = received.payload.room.code;

  // Lets the stylesheet dim the screen at night.
  useEffect(() => {
    document.documentElement.dataset.phase = view.phase;
    return () => {
      delete document.documentElement.dataset.phase;
    };
  }, [view.phase]);

  // Phones stay awake for the whole game (where the browser allows it).
  useWakeLock(prefs.keepAwake && view.phase !== "GAME_OVER");

  // Private notes only last for the game they were written in.
  useEffect(() => {
    if (view.phase === "GAME_OVER") clearNotes();
  }, [view.phase]);

  // The host's pauses and skips appear for everyone as a short message.
  const seenLog = useRef(view.log.length);
  useEffect(() => {
    const fresh = view.log.slice(seenLog.current);
    seenLog.current = view.log.length;
    if (you?.isHost) return;
    for (const entry of fresh) {
      if (entry.kind === "paused" || entry.kind === "resumed" || entry.kind === "time_added" || entry.kind === "discussion_skipped") {
        showToast(describeLogEntry(entry, view).text);
      }
    }
  }, [view.log.length]);

  // Who just left the game, so their row fades out during the announcement.
  const fadingIds =
    view.phase === "NIGHT_RESULTS"
      ? (view.nightReport?.deaths.map((d) => d.playerId) ?? [])
      : view.phase === "VOTE_RESULTS"
        ? (view.voteReport?.deaths.map((d) => d.playerId) ?? [])
        : [];

  const chatPhase = ["NIGHT_RESULTS", "DAY_DISCUSSION", "VOTING", "VOTE_RESULTS", "GAME_OVER"].includes(view.phase);
  const graveyardNight = view.phase === "NIGHT" && (watching || out);
  const showSide = chatPhase || graveyardNight;

  let screen;
  switch (view.phase) {
    case "ROLE_REVEAL":
      screen = <RoleRevealScreen received={received} />;
      break;
    case "NIGHT":
      screen = <NightScreen received={received} />;
      break;
    case "NIGHT_RESULTS":
      screen = <NightResultsScreen received={received} />;
      break;
    case "DAY_DISCUSSION":
      screen = <DayScreen received={received} />;
      break;
    case "VOTING":
      screen = <VotingScreen received={received} />;
      break;
    case "VOTE_RESULTS":
      screen = <VoteResultsScreen received={received} />;
      break;
    default:
      screen = <GameOverScreen received={received} />;
  }

  return (
    <div className={`screen screen-wide game phase-${view.phase.toLowerCase().replace(/_/g, "-")}`}>
      <GameTopBar received={received} onHelp={() => setHelpOpen(true)} />

      {watching ? (
        <p className="info-banner" role="status">
          <Icon name="eye" />
          You're watching. You'll join the next game.
        </p>
      ) : null}
      {out && view.phase !== "GAME_OVER" ? (
        <p className="info-banner" role="status">
          <Icon name={wordsFor(view.settings).outIcon} />
          {wordsFor(view.settings).outBanner}
        </p>
      ) : null}

      <div className={`game-grid${showSide ? " has-side" : ""}`}>
        <div className="game-main">
          <PhaseHint id={hintFor(view.phase)} />
          {screen}
          {view.phase !== "ROLE_REVEAL" && view.phase !== "GAME_OVER" ? (
            <>
              <MyRoleCard view={view} />
              <NotesPanel view={view} roomCode={roomCode} />
              <EventLog view={view} />
            </>
          ) : null}
        </div>
        {showSide ? (
          <aside className="game-side" aria-label="Chat and players">
            <ChatPanel view={view} roomCode={received.payload.room.code} />
            <section className="card" aria-labelledby="game-players-title">
              <h2 id="game-players-title" className="card-title">
                Players
              </h2>
              <PlayerList
                players={view.players}
                youId={you?.id ?? null}
                viewerIsHost={you?.isHost === true}
                phase={view.phase}
                fadingIds={fadingIds}
                wording={view.settings}
              />
            </section>
            <SpectatorList spectators={view.spectators} youId={you?.id ?? null} viewerIsHost={you?.isHost === true} />
          </aside>
        ) : null}
      </div>

      <LeaveRoomButton inGame={view.phase !== "GAME_OVER" && !watching} />
      {helpOpen ? <HelpSheet settings={view.settings} onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}
