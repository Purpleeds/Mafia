import type {
  DeathView,
  GameView,
  NightActionView,
  PublicPlayerView,
  Role,
  VoteRoundSummaryView,
  YouView,
} from "@mafia/shared";
import { availableNightAction } from "./night.js";
import { findPlayer, has } from "./state.js";
import type { DeathRecord, GameState, PlayerState } from "./types.js";
import { validVoteTargets } from "./voting.js";

/**
 * Builds exactly what `viewerId` is allowed to know. This is the only way game
 * data should leave the server: roles, night choices and detective results are
 * included only for the people entitled to them.
 */
export function getGameView(state: GameState, viewerId: string): GameView {
  const viewer = findPlayer(state, viewerId);
  const gameOver = state.phase === "GAME_OVER";

  const publicRole = (p: PlayerState): Role | null =>
    p.role !== null && (gameOver || (!p.alive && state.settings.revealRoleOnDeath)) ? p.role : null;

  const deathViews = (deaths: DeathRecord[]): DeathView[] =>
    deaths.map((d) => {
      const p = findPlayer(state, d.playerId);
      return { playerId: d.playerId, cause: d.cause, role: p ? publicRole(p) : null };
    });

  const players: PublicPlayerView[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    connected: p.connected,
    isHost: p.id === state.hostId,
    role: publicRole(p),
    done:
      state.phase === "ROLE_REVEAL"
        ? p.ackedRole
        : state.phase === "VOTING" && state.voting !== null
          ? has(state.voting.ballots, p.id)
          : false,
  }));

  const nightReport = state.nightReport
    ? { round: state.nightReport.round, deaths: deathViews(state.nightReport.deaths) }
    : null;

  const voteReport = state.voteReport
    ? { ...state.voteReport, deaths: deathViews(state.voteReport.deaths) }
    : null;

  let voting: GameView["voting"] = null;
  if (state.phase === "VOTING" && state.voting) {
    const previous: (VoteRoundSummaryView & { tiedOptions: string[] }) | null = state.voting.previous;
    voting = {
      round: state.voting.round,
      candidateIds: state.voting.candidates,
      previous,
      validTargetIds: viewer ? validVoteTargets(state, viewer) : [],
      myBallot: viewer ? (state.voting.ballots[viewer.id] ?? null) : null,
    };
  }

  const winnerIds = gameOver ? state.players.filter((p) => isWinner(state, p)).map((p) => p.id) : [];

  return {
    phase: state.phase,
    settings: state.settings,
    hostId: state.hostId,
    round: state.round,
    phaseEndsAt: state.phaseEndsAt,
    mafiaCount: state.mafiaCount,
    players,
    you: viewer ? buildYou(state, viewer) : null,
    nightReport,
    voteReport,
    voting,
    winner: state.winner,
    winnerIds,
  };
}

function isWinner(state: GameState, p: PlayerState): boolean {
  switch (state.winner) {
    case "town":
      return p.role !== null && p.role !== "mafia" && p.role !== "jester";
    case "mafia":
      return p.role === "mafia";
    case "jester":
      return p.role === "jester";
    default:
      return false;
  }
}

function buildYou(state: GameState, viewer: PlayerState): YouView {
  const gameOver = state.phase === "GAME_OVER";
  const isMafia = viewer.role === "mafia";

  const teammateIds = isMafia
    ? state.players.filter((p) => p.role === "mafia" && p.id !== viewer.id).map((p) => p.id)
    : [];

  const knowsLovers =
    state.lovers !== null && (gameOver || viewer.role === "cupid" || state.lovers.includes(viewer.id));

  return {
    id: viewer.id,
    name: viewer.name,
    role: viewer.role,
    alive: viewer.alive,
    isHost: viewer.id === state.hostId,
    teammateIds,
    loverIds: knowsLovers && state.lovers ? [...state.lovers] : null,
    investigations: viewer.role === "detective" ? state.investigations.map((i) => ({ ...i })) : [],
    nightAction: state.phase === "NIGHT" ? buildNightAction(state, viewer) : null,
  };
}

function buildNightAction(state: GameState, viewer: PlayerState): NightActionView | null {
  const action = availableNightAction(state, viewer);
  if (!action) return null;
  const { night } = state;

  let picks: string[] = [];
  switch (action.kind) {
    case "kill": {
      const mine = night.mafiaVotes[viewer.id];
      picks = mine === undefined ? [] : [mine];
      break;
    }
    case "protect":
      picks = night.protect === null ? [] : [night.protect];
      break;
    case "investigate":
      picks = night.investigate === null ? [] : [night.investigate];
      break;
    case "guard":
      picks = night.guard === null ? [] : [night.guard];
      break;
    case "link":
      picks = night.link ? [...night.link] : [];
      break;
  }

  return {
    kind: action.kind,
    validTargetIds: action.validTargetIds,
    picks,
    teammateVotes: action.kind === "kill" ? { ...night.mafiaVotes } : null,
  };
}
