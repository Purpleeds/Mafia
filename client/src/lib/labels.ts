import type { ConnectionStatus, Phase, Role, TieRule, Winner } from "@mafia/shared";

export const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: "Lobby",
  ROLE_REVEAL: "Role reveal",
  NIGHT: "Night",
  NIGHT_RESULTS: "Morning news",
  DAY_DISCUSSION: "Day discussion",
  VOTING: "Voting",
  VOTE_RESULTS: "Vote results",
  GAME_OVER: "Game over",
};

export const ROLE_LABEL: Record<Role, string> = {
  mafia: "Mafia",
  doctor: "Doctor",
  detective: "Detective",
  villager: "Villager",
  jester: "Jester",
  bodyguard: "Bodyguard",
  cupid: "Cupid",
};

export const WINNER_LABEL: Record<Winner, string> = {
  town: "The Town wins!",
  mafia: "The Mafia wins!",
  jester: "The Jester wins!",
};

export const TIE_RULE_LABEL: Record<TieRule, string> = {
  no_elimination: "Nobody is eliminated",
  revote: "Revote between the tied players",
};

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  online: "Online",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

export const CONNECTION_ICON: Record<ConnectionStatus, string> = {
  online: "●",
  reconnecting: "◐",
  offline: "○",
};

export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} min` : `${m}:${String(rest).padStart(2, "0")}`;
}
