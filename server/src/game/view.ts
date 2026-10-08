import type {
  ChatChannel,
  DeathView,
  GameView,
  NightActionView,
  PublicPlayerView,
  Role,
  SpectatorView,
  TimelineEntry,
  VoteRoundSummaryView,
  YouView,
} from "@mafia/shared";
import { canRead, canWrite } from "./chat.js";
import { availableNightAction } from "./night.js";
import { findPlayer, findSpectator, has } from "./state.js";
import type { DeathRecord, GameState, PlayerState, SpectatorState } from "./types.js";
import { validVoteTargets } from "./voting.js";

/**
 * Builds exactly what `viewerId` is allowed to know. This is the only way game
 * data should leave the server: roles, night choices and detective results are
 * included only for the people entitled to them.
 */
export function getGameView(state: GameState, viewerId: string): GameView {
  const viewer = findPlayer(state, viewerId);
  const spectator = viewer ? undefined : findSpectator(state, viewerId);
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
    avatar: { ...p.avatar },
    alive: p.alive,
    connected: p.connected,
    connection: p.connected ? "online" : "offline",
    isHost: p.id === state.hostId,
    kicked: p.kicked,
    role: publicRole(p),
    done:
      state.phase === "ROLE_REVEAL"
        ? p.ackedRole
        : state.phase === "VOTING" && state.voting !== null
          ? has(state.voting.ballots, p.id)
          : false,
  }));

  const spectators: SpectatorView[] = state.spectators.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: { ...p.avatar },
    connected: p.connected,
    connection: p.connected ? "online" : "offline",
  }));

  // A save stays secret unless the host announces saves; then everyone learns that one happened, not who.
  const nightReport = state.nightReport
    ? {
        round: state.nightReport.round,
        deaths: deathViews(state.nightReport.deaths),
        saved: state.settings.announceSaves && state.nightReport.saved,
      }
    : null;

  // Who voted for whom is only public if the host allows it; the counts always are.
  const showVotes = state.settings.showVotes;
  const voteReport = state.voteReport
    ? {
        ...state.voteReport,
        ballots: showVotes ? { ...state.voteReport.ballots } : {},
        deaths: deathViews(state.voteReport.deaths),
      }
    : null;

  let voting: GameView["voting"] = null;
  if (state.phase === "VOTING" && state.voting) {
    const previous: (VoteRoundSummaryView & { tiedOptions: string[] }) | null = state.voting.previous
      ? { ...state.voting.previous, ballots: showVotes ? { ...state.voting.previous.ballots } : {} }
      : null;
    const liveTally: Record<string, number> = {};
    for (const choice of Object.values(state.voting.ballots)) liveTally[choice] = (liveTally[choice] ?? 0) + 1;
    voting = {
      live: { tally: liveTally, ballots: showVotes ? { ...state.voting.ballots } : null },
      round: state.voting.round,
      candidateIds: state.voting.candidates,
      previous,
      validTargetIds: viewer ? validVoteTargets(state, viewer) : [],
      myBallot: viewer ? (state.voting.ballots[viewer.id] ?? null) : null,
    };
  }

  const timeline: TimelineEntry[] = gameOver
    ? state.history.map((h) => ({
        round: h.round,
        night: { ...h.night, deaths: deathViews(h.night.deaths) },
        vote: h.vote ? { ...h.vote, deaths: deathViews(h.vote.deaths) } : null,
      }))
    : [];

  const winnerIds = gameOver ? state.players.filter((p) => isWinner(state, p)).map((p) => p.id) : [];

  return {
    phase: state.phase,
    settings: state.settings,
    hostId: state.hostId,
    round: state.round,
    phaseEndsAt: state.phaseEndsAt,
    mafiaCount: state.mafiaCount,
    players,
    spectators,
    you: viewer ? buildYou(state, viewer) : spectator ? spectatorYou(state, spectator) : null,
    nightReport,
    voteReport,
    narration: state.narration
      ? {
          kind: state.narration.kind,
          round: state.narration.round,
          status: state.narration.status === "ready" ? "ready" : "thinking",
          text: state.narration.text,
          source: state.narration.source,
        }
      : null,
    voting,
    winner: state.winner,
    winnerIds,
    timeline,
  };
}

const CHANNELS: ChatChannel[] = ["public", "mafia", "graveyard"];

function chatAccess(state: GameState, memberId: string): { write: ChatChannel[]; read: ChatChannel[] } {
  return {
    write: CHANNELS.filter((c) => canWrite(state, memberId, c)),
    read: CHANNELS.filter((c) => canRead(state, memberId, c)),
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
    avatar: { ...viewer.avatar },
    role: viewer.role,
    alive: viewer.alive,
    isHost: viewer.id === state.hostId,
    isSpectator: false,
    teammateIds,
    loverIds: knowsLovers && state.lovers ? [...state.lovers] : null,
    investigations: viewer.role === "detective" ? state.investigations.map((i) => ({ ...i })) : [],
    protectedId: viewer.role === "doctor" ? state.doctorLastProtectedId : null,
    nightAction: state.phase === "NIGHT" ? buildNightAction(state, viewer) : null,
    chat: chatAccess(state, viewer.id),
  };
}

/** A spectator learns nothing beyond the public view. */
function spectatorYou(state: GameState, spectator: SpectatorState): YouView {
  return {
    id: spectator.id,
    name: spectator.name,
    avatar: { ...spectator.avatar },
    role: null,
    alive: false,
    isHost: false,
    isSpectator: true,
    teammateIds: [],
    loverIds: state.phase === "GAME_OVER" && state.lovers ? [...state.lovers] : null,
    investigations: [],
    protectedId: null,
    nightAction: null,
    chat: chatAccess(state, spectator.id),
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
