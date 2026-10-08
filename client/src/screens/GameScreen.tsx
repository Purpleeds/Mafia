import { useEffect, useState } from "react";
import { Icon } from "../art/icons";
import { ChatPanel } from "../components/ChatPanel";
import { GameTopBar } from "../components/GameTopBar";
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
import { myPlayer, nameOf } from "./game/common";
import { wordsFor } from "../lib/wording";

/** Every in-game phase: a status bar, the phase's screen, and a side column (chat and players) where it helps. */
export function GameScreen({ received }: { received: ReceivedState }) {
  const { view } = received.payload;
  const [helpOpen, setHelpOpen] = useState(false);
  const you = view.you;
  const me = myPlayer(view);
  const watching = !!you?.isSpectator || !me;
  const out = !!me && !me.alive;

  // Lets the stylesheet dim the screen at night.
  useEffect(() => {
    document.documentElement.dataset.phase = view.phase;
    return () => {
      delete document.documentElement.dataset.phase;
    };
  }, [view.phase]);

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
      {you?.loverIds && view.phase !== "GAME_OVER" ? (
        <p className="info-banner" role="status">
          <Icon name="heart" />
          {you.loverIds.includes(you.id)
            ? `You and ${nameOf(view, you.loverIds.find((id) => id !== you.id) ?? "")} are lovers. If one goes, so does the other.`
            : `You linked ${nameOf(view, you.loverIds[0])} and ${nameOf(view, you.loverIds[1])}.`}
        </p>
      ) : null}

      <div className={`game-grid${showSide ? " has-side" : ""}`}>
        <div className="game-main">{screen}</div>
        {showSide ? (
          <aside className="game-side" aria-label="Chat and players">
            <ChatPanel view={view} />
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
