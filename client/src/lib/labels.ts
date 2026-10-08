import type { ConnectionStatus, Phase } from "@mafia/shared";

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

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  online: "Online",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} min` : `${m}:${String(rest).padStart(2, "0")}`;
}
