import type { RoomNoticePayload } from "@mafia/shared";

/** The toast for something that happened to someone in the room. Null when there's nothing to say. */
export function noticeText(notice: RoomNoticePayload, youId: string | null): string | null {
  const { name } = notice;
  const you = notice.playerId === youId;
  switch (notice.kind) {
    case "joined":
      // Bots coming and going are already visible in the player list (Fill adds several at once).
      return notice.isBot ? null : `${name} joined.`;
    case "left":
      return notice.isBot ? null : `${name} left the room.`;
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
    case "bot_takeover":
      return you ? "A bot played for you while you were away." : `A bot is now playing for ${name}.`;
    case "bot_released":
      return you ? "You're back in control." : `${name} is back and playing again.`;
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
