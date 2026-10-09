import type { RoomNoticePayload } from "@mafia/shared";

/** The toast for something that happened to someone in the room. Null when there's nothing to say. */
export function noticeText(notice: RoomNoticePayload, youId: string | null): string | null {
  const { name } = notice;
  const you = notice.playerId === youId;
  switch (notice.kind) {
    case "joined":
      return `${name} joined.`;
    case "left":
      return `${name} left the room.`;
    case "kicked":
      return `${name} was removed by the host.`;
    case "dropped":
      return `${name} was away too long and left the room.`;
    case "disconnected":
      return `${name} lost their connection.`;
    case "reconnected":
      return `${name} is back.`;
    case "host_changed":
      return you ? "You're now the host." : `${name} is now the host.`;
    case "avatar_approved":
      return "The host approved your picture. Everyone can see it now.";
    case "avatar_rejected":
      return "The host didn't approve your picture, so you're using your drawn avatar.";
    case "avatar_removed":
      return "The host removed your picture, so you're using your drawn avatar.";
    default:
      return null;
  }
}
