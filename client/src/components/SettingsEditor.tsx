import { useState, type FormEvent } from "react";
import {
  OPTIONAL_ROLES,
  ROOM_PASSWORD_MAX_LENGTH,
  TIE_RULES,
  maxMafiaCount,
  validateRoomPassword,
  type ContentMode,
  type GameSettings,
  type OptionalRole,
  type SettingsPatch,
  type TimerSettings,
} from "@mafia/shared";
import { TIE_RULE_LABEL, formatSeconds } from "../lib/labels";
import { OPTIONAL_ROLE_INFO, TIMER_KEYS, TIMER_LABEL, mafiaCountLabel, timerOptions } from "../lib/settings";
import { useAction } from "../lib/useAction";
import { call } from "../net/socket";
import { ErrorText } from "./ErrorText";

const MODE_INFO: Record<ContentMode, { label: string; emoji: string; description: string }> = {
  safe: { label: "Safe", emoji: "🎈", description: "Family-friendly and cartoony. Nobody gets hurt, they just go home." },
  normal: { label: "Normal", emoji: "🕵️", description: "Classic crime drama with darker narration." },
};

function rolePatch(role: OptionalRole, on: boolean): Partial<Record<OptionalRole, boolean>> {
  const patch: Partial<Record<OptionalRole, boolean>> = {};
  patch[role] = on;
  return patch;
}

function timerPatch(key: keyof TimerSettings, seconds: number): Partial<TimerSettings> {
  const patch: Partial<TimerSettings> = {};
  patch[key] = seconds;
  return patch;
}

interface SettingsEditorProps {
  settings: GameSettings;
  playerCount: number;
}

/** Host-only settings. Every change is sent straight away; the server's answer updates the view. */
export function SettingsEditor({ settings, playerCount }: SettingsEditorProps) {
  const action = useAction();
  const send = (patch: SettingsPatch) => void action.run(() => call("host:updateSettings", patch));

  const maxMafia = maxMafiaCount(playerCount);
  const mafiaChoices: number[] = [];
  for (let n = 1; n <= maxMafia; n++) mafiaChoices.push(n);
  if (typeof settings.mafiaCount === "number" && !mafiaChoices.includes(settings.mafiaCount)) {
    mafiaChoices.push(settings.mafiaCount);
  }

  return (
    <section className="card" aria-labelledby="settings-title">
      <h2 id="settings-title" className="card-title">
        Game settings
      </h2>
      <div className="stack">
        <fieldset className="mode-toggle">
          <legend>Content mode</legend>
          <div className="segmented segmented-large">
            {(["safe", "normal"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`segment${settings.contentMode === mode ? " is-selected" : ""}`}
                aria-pressed={settings.contentMode === mode}
                onClick={() => settings.contentMode !== mode && send({ contentMode: mode })}
              >
                <span className="segment-emoji" aria-hidden="true">
                  {MODE_INFO[mode].emoji}
                </span>
                <span>{MODE_INFO[mode].label}</span>
              </button>
            ))}
          </div>
          <p className="field-hint">{MODE_INFO[settings.contentMode].description}</p>
        </fieldset>

        <div className="field">
          <label htmlFor="setting-mafia">Mafia players</label>
          <select
            id="setting-mafia"
            className="input"
            value={String(settings.mafiaCount)}
            onChange={(e) => {
              const v = e.target.value;
              send({ mafiaCount: v === "auto" ? "auto" : Number(v) });
            }}
          >
            <option value="auto">{mafiaCountLabel("auto", playerCount)}</option>
            {mafiaChoices.map((n) => (
              <option key={n} value={String(n)}>
                {n}
                {n > maxMafia ? ` (too many for ${playerCount} players)` : ""}
              </option>
            ))}
          </select>
          <p className="field-hint">Up to {maxMafia} with the current number of players.</p>
        </div>

        <fieldset className="field">
          <legend>Extra roles</legend>
          {OPTIONAL_ROLES.map((role) => {
            const info = OPTIONAL_ROLE_INFO[role];
            const id = `setting-role-${role}`;
            return (
              <label key={role} htmlFor={id} className="switch-row">
                <span className="switch-text">
                  <span>
                    <span aria-hidden="true">{info.emoji} </span>
                    {info.label}
                  </span>
                  <span className="field-hint">{info.description}</span>
                </span>
                <input
                  id={id}
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={settings.optionalRoles[role]}
                  onChange={(e) => send({ optionalRoles: rolePatch(role, e.target.checked) })}
                />
              </label>
            );
          })}
        </fieldset>

        <fieldset className="field">
          <legend>When the vote is tied</legend>
          <div className="segmented">
            {TIE_RULES.map((rule) => (
              <button
                key={rule}
                type="button"
                className={`segment${settings.tieRule === rule ? " is-selected" : ""}`}
                aria-pressed={settings.tieRule === rule}
                onClick={() => settings.tieRule !== rule && send({ tieRule: rule })}
              >
                {TIE_RULE_LABEL[rule]}
              </button>
            ))}
          </div>
        </fieldset>

        <label htmlFor="setting-reveal" className="switch-row">
          <span className="switch-text">
            <span>Reveal roles on elimination</span>
            <span className="field-hint">Everyone sees an eliminated player's role.</span>
          </span>
          <input
            id="setting-reveal"
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.revealRoleOnDeath}
            onChange={(e) => send({ revealRoleOnDeath: e.target.checked })}
          />
        </label>

        <label htmlFor="setting-show-votes" className="switch-row">
          <span className="switch-text">
            <span>Show who voted for whom</span>
            <span className="field-hint">Vote counts are always shown. Turn this off to keep each vote secret.</span>
          </span>
          <input
            id="setting-show-votes"
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.showVotes}
            onChange={(e) => send({ showVotes: e.target.checked })}
          />
        </label>

        <details className="advanced">
          <summary>Timers</summary>
          <div className="timer-grid">
            {TIMER_KEYS.map((key) => {
              const id = `setting-timer-${key}`;
              const current = settings.timers[key];
              return (
                <div key={key} className="field">
                  <label htmlFor={id}>{TIMER_LABEL[key]}</label>
                  <select
                    id={id}
                    className="input"
                    value={String(current)}
                    onChange={(e) => send({ timers: timerPatch(key, Number(e.target.value)) })}
                  >
                    {timerOptions(key, current).map((v) => (
                      <option key={v} value={String(v)}>
                        {formatSeconds(v)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </details>

        <ErrorText error={action.error} />
      </div>
    </section>
  );
}

/** Host-only: set, change or remove the room password. */
export function PasswordEditor({ hasPassword }: { hasPassword: boolean }) {
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const action = useAction();
  const check = password === "" ? null : validateRoomPassword(password);
  const hint = check && !check.ok ? check.reason : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!check?.ok) return;
    const result = await action.run(() => call("host:setPassword", { password: check.value }));
    if (result.ok) {
      setPassword("");
      setEditing(false);
    }
  };

  const remove = async () => {
    await action.run(() => call("host:setPassword", { password: null }));
  };

  return (
    <section className="card" aria-labelledby="password-title">
      <h2 id="password-title" className="card-title">
        <span aria-hidden="true">{hasPassword ? "🔒 " : "🔓 "}</span>
        {hasPassword ? "Private room" : "Open room"}
      </h2>
      <p className="field-hint">
        {hasPassword ? "New players need the password to join." : "Anyone with the code or link can join."}
      </p>
      {editing ? (
        <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label htmlFor="room-password">{hasPassword ? "New password" : "Password"}</label>
            <input
              id="room-password"
              type="password"
              className={`input${hint ? " has-error" : ""}`}
              value={password}
              autoComplete="new-password"
              maxLength={ROOM_PASSWORD_MAX_LENGTH * 2}
              aria-invalid={hint ? true : undefined}
              aria-describedby="room-password-hint"
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <ErrorText id="room-password-hint" error={hint} />
          </div>
          <div className="button-row">
            <button type="submit" className="btn btn-primary" disabled={!check?.ok || action.pending}>
              Save password
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            {hasPassword ? "Change password" : "Set a password"}
          </button>
          {hasPassword ? (
            <button type="button" className="btn btn-danger-outline" disabled={action.pending} onClick={() => void remove()}>
              Remove password
            </button>
          ) : null}
        </div>
      )}
      <ErrorText error={action.error} />
    </section>
  );
}
