import { MIN_PLAYERS, PRESETS, PRESET_IDS, matchingPreset, presetPatch, type GameSettings, type PresetId, type SettingsPatch } from "@mafia/shared";
import { fill } from "../lib/wording";

/** The preset these settings match, as words: "Quick game", or "Custom". */
export function presetName(settings: GameSettings): string {
  const id = matchingPreset(settings);
  return id ? PRESETS[id].name : "Custom";
}

/**
 * Classic / Quick game / Chaos. Picking one sets the rules (roles, timers,
 * votes) in one go and leaves the mode, the Mafia's name, the chat filter and
 * the AI narrator alone, so each works in Safe and Normal Mode.
 */
export function PresetPicker({
  settings,
  playerCount,
  disabled,
  onApply,
}: {
  settings: GameSettings;
  playerCount: number;
  disabled: boolean;
  onApply: (patch: SettingsPatch) => void;
}) {
  const current = matchingPreset(settings);
  return (
    <fieldset className="field preset-picker">
      <legend>Game preset</legend>
      <div className="preset-list">
        {PRESET_IDS.map((id: PresetId) => {
          const preset = PRESETS[id];
          const selected = current === id;
          // Only worth saying when a preset needs more than the game's own minimum (the Start button covers that).
          const short = preset.minPlayers > MIN_PLAYERS && playerCount < preset.minPlayers;
          return (
            <button
              key={id}
              type="button"
              className={`preset-option${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => !selected && onApply(presetPatch(id))}
            >
              <span className="preset-name">{preset.name}</span>
              <span className="preset-text">{fill(preset.description, settings)}</span>
              {short ? (
                <span className="preset-note">Needs {preset.minPlayers} or more players to start.</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="field-hint" role="status">
        {current ? `Playing ${PRESETS[current].name}.` : "Custom settings: you've changed something below."} Any setting
        below can still be changed.
      </p>
    </fieldset>
  );
}
