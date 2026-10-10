import {
  BOT_DIFFICULTIES,
  MAX_BOTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type BotDifficulty,
  type GameSettings,
  type GameView,
  type SettingsPatch,
} from "@mafia/shared";
import { Icon } from "../art/icons";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import { ErrorText } from "./ErrorText";

export const BOT_DIFFICULTY_INFO: Record<BotDifficulty, { label: string; description: string }> = {
  easy: { label: "Easy", description: "Bots mostly pick at random. Good for learning the game." },
  normal: {
    label: "Normal",
    description: "Bots read the votes and the chat, team up when they're in the Mafia, and push their suspicions.",
  },
};

/**
 * Host only, in the lobby: add or remove bots when there aren't enough
 * players, and choose how they play. Bots are labelled everywhere, and only
 * know what a person with their role would know.
 */
export function BotsCard({ view }: { view: GameView }) {
  const action = useAction();
  const settings = view.settings;
  const players = view.players.length;
  const bots = view.players.filter((p) => p.isBot).length;
  const people = players - bots;
  const missing = Math.max(0, MIN_PLAYERS - players);
  const busy = action.pending;
  const send = (patch: SettingsPatch) => void action.run(() => call("host:updateSettings", patch));

  return (
    <section className="card bots-card" aria-labelledby="bots-title">
      <div className="card-header">
        <h2 id="bots-title" className="card-title">
          <Icon name="bot" /> Bots
        </h2>
        <span className="count bots-count" aria-label={`${bots} of ${MAX_BOTS} bots`}>
          {bots}/{MAX_BOTS}
        </span>
      </div>
      <p className="field-hint">
        Not enough players? Bots fill the empty seats. They're labelled "Bot" everywhere, and only know what their role
        would know.
      </p>
      <div className="bots-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || missing === 0}
          onClick={() => void action.run(() => call("host:fillBots", {}))}
        >
          <Icon name="userPlus" />
          {missing === 0 ? `Fill to ${MIN_PLAYERS}` : `Fill to ${MIN_PLAYERS} (+${missing})`}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || bots >= MAX_BOTS || players >= MAX_PLAYERS}
          onClick={() => void action.run(() => call("host:addBot", {}))}
        >
          <Icon name="plus" />
          Add bot
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || bots === 0}
          onClick={() => void action.run(() => call("host:removeBot", {}))}
        >
          <Icon name="userMinus" />
          Remove bot
        </button>
      </div>

      <div className="stack">
        <fieldset className="field" aria-describedby="bots-difficulty-hint">
          <legend>Bot difficulty</legend>
          <div className="segmented">
            {BOT_DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                className={`segment${settings.botDifficulty === d ? " is-selected" : ""}`}
                aria-pressed={settings.botDifficulty === d}
                disabled={busy}
                onClick={() => settings.botDifficulty !== d && send({ botDifficulty: d })}
              >
                {BOT_DIFFICULTY_INFO[d].label}
              </button>
            ))}
          </div>
          <p id="bots-difficulty-hint" className="field-hint">
            {BOT_DIFFICULTY_INFO[settings.botDifficulty].description}
          </p>
        </fieldset>

        <label htmlFor="setting-solo" className="switch-row">
          <span className="switch-text">
            <span>Solo practice</span>
            <span className="field-hint">
              Play with just you and bots. When it's off, a game needs at least 2 real players
              {people < 2 ? ` (${people} now)` : ""}.
            </span>
          </span>
          <input
            id="setting-solo"
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.soloPractice}
            disabled={busy}
            onChange={(e) => send({ soloPractice: e.target.checked })}
          />
        </label>

        <label htmlFor="setting-replace-bots" className="switch-row">
          <span className="switch-text">
            <span>Replace a bot when someone joins</span>
            <span className="field-hint">When the room is full or at the size you filled it to, a bot leaves to make space.</span>
          </span>
          <input
            id="setting-replace-bots"
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.replaceBots}
            disabled={busy}
            onChange={(e) => send({ replaceBots: e.target.checked })}
          />
        </label>

        <label htmlFor="setting-bot-takeover" className="switch-row">
          <span className="switch-text">
            <span>Bot takes over for disconnected players</span>
            <span className="field-hint">
              If someone stays disconnected, a bot plays their role with what they knew, until they come back.
            </span>
          </span>
          <input
            id="setting-bot-takeover"
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.botTakeover}
            disabled={busy}
            onChange={(e) => send({ botTakeover: e.target.checked })}
          />
        </label>
      </div>
      <ErrorText error={action.error} />
    </section>
  );
}

/** One line for the settings summary that everyone else sees. */
export function botSettingsSummary(s: GameSettings, bots: number): string {
  const parts = [
    bots === 0 ? "None yet" : `${bots} (${BOT_DIFFICULTY_INFO[s.botDifficulty].label})`,
    s.replaceBots ? "a bot makes space when someone joins" : "bots stay when someone joins",
    s.botTakeover ? "a bot plays for anyone who disconnects" : "no stand-ins for disconnected players",
  ];
  if (s.soloPractice) parts.push("solo practice allowed");
  return parts.join(" · ");
}
