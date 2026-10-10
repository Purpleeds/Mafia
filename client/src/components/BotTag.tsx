import type { PublicPlayerView } from "@mafia/shared";
import { Icon } from "../art/icons";

type BotFlags = Pick<PublicPlayerView, "isBot" | "botPlaying">;

/**
 * The small label next to a bot's name, everywhere it appears, so nobody
 * mistakes a bot for a person. A real player who is away gets "Bot playing"
 * while a bot plays their seat.
 */
export function BotTag({ player }: { player: BotFlags | null | undefined }) {
  if (!player) return null;
  if (player.isBot) {
    return (
      <span className="bot-tag" title="A computer player the host added">
        <Icon name="bot" size={12} />
        Bot
      </span>
    );
  }
  if (player.botPlaying) {
    return (
      <span className="bot-tag bot-tag-standin" title="They're away, so a bot is playing for them until they're back">
        <Icon name="bot" size={12} />
        Bot playing
      </span>
    );
  }
  return null;
}
