import type { GameStatsView, GameView } from "@mafia/shared";
import { Icon, type IconName } from "../../art/icons";
import { AvatarBadge } from "../../components/AvatarBadge";
import { fill } from "../../lib/wording";

/** "Ana", "Ana and Ben", "Ana, Ben and Cleo". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface StatLine {
  key: string;
  icon: IconName;
  title: string;
  playerIds: string[];
  text: string;
}

/** The end-of-game highlights as words, in the room's mode and with the Mafia's name. Shared by the card and tests. */
export function statLines(stats: GameStatsView, view: Pick<GameView, "players" | "settings">): StatLine[] {
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? "Someone";
  const names = (ids: string[]) => joinNames(ids.map(name));
  const safe = view.settings.contentMode === "safe";
  const lines: StatLine[] = [];

  if (stats.survivedLongest) {
    const ids = stats.survivedLongest.playerIds;
    lines.push({
      key: "survived",
      icon: "trophy",
      title: "Survived longest",
      playerIds: ids,
      text: `${names(ids)} ${ids.length === 1 ? "was" : "were"} still in the game at the very end.`,
    });
  }
  if (stats.lastToLeave) {
    const { playerIds, round, part } = stats.lastToLeave;
    const when = part === "night" ? `night ${round}` : `the vote on day ${round}`;
    lines.push({
      key: "last",
      icon: "timer",
      title: "Held on the longest",
      playerIds,
      text: `Of the players who ${safe ? "went home" : "were eliminated"}, ${names(playerIds)} lasted longest: until ${when}.`,
    });
  }
  if (stats.bestDetective) {
    const { playerIds, entries } = stats.bestDetective;
    const clues = (e: { mafiaVotes: number; mafiaFound: number }) => {
      const parts: string[] = [];
      if (e.mafiaVotes > 0) parts.push(plural(e.mafiaVotes, "vote", "votes"));
      if (e.mafiaFound > 0) parts.push(plural(e.mafiaFound, "investigation", "investigations"));
      return parts.join(" and ");
    };
    const kinds = new Set(entries.map(clues));
    const first = entries[0];
    const text =
      kinds.size === 1 && first
        ? `${names(playerIds)}: ${clues(first)}${entries.length > 1 ? " each" : ""} pointed straight at {theGang}.`
        : `${joinNames(entries.map((e) => `${name(e.playerId)} (${clues(e)})`))} pointed straight at {theGang}.`;
    lines.push({ key: "detective", icon: "search", title: "Best detective", playerIds, text: fill(text, view.settings) });
  }
  if (stats.mostSuspiciousVoter) {
    const { playerIds, innocentVotes, totalVotes } = stats.mostSuspiciousVoter;
    const each = playerIds.length > 1 ? " each" : "";
    lines.push({
      key: "suspicious",
      icon: "suspicious",
      title: "Most suspicious voter",
      playerIds,
      text: `${names(playerIds)} voted against innocent players ${innocentVotes} of ${plural(totalVotes, "time", "times")}${each}.`,
    });
  } else if (stats.votesSecret) {
    lines.push({
      key: "suspicious",
      icon: "ballot",
      title: "Most suspicious voter",
      playerIds: [],
      text: "Votes were secret this game, so nobody's votes are judged.",
    });
  }
  return lines;
}

/** Highlights card on the game-over screen. */
export function GameStats({ view }: { view: GameView }) {
  if (!view.stats) return null;
  const lines = statLines(view.stats, view);
  if (lines.length === 0) return null;
  return (
    <section className="card stats-card" aria-labelledby="stats-title">
      <h2 id="stats-title" className="card-title">
        <Icon name="sparkle" size={20} /> Highlights
      </h2>
      <ul className="stats-list">
        {lines.map((line) => (
          <li key={line.key} className="stat">
            <Icon name={line.icon} size={26} className="stat-icon" />
            <div className="stat-body">
              <h3 className="stat-title">{line.title}</h3>
              <p className="stat-text">{line.text}</p>
              {line.playerIds.length > 0 && line.playerIds.length <= 6 ? (
                <div className="stat-avatars" aria-hidden="true">
                  {line.playerIds.map((id) => {
                    const p = view.players.find((x) => x.id === id);
                    return p ? <AvatarBadge key={id} avatar={p.avatar} size={30} /> : null;
                  })}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
