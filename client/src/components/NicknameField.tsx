import { NICKNAME_MAX_LENGTH, validateNickname } from "@mafia/shared";
import { Icon } from "../art/icons";

interface NicknameFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** An error from the server (e.g. name taken). */
  serverError?: string | null;
  /** Show the validation message even if untouched (after a submit attempt). */
  showValidation?: boolean;
  autoFocus?: boolean;
}

export function NicknameField({ id, value, onChange, serverError, showValidation, autoFocus }: NicknameFieldProps) {
  const check = validateNickname(value);
  const localError = !check.ok && (value.length > 0 || showValidation) ? check.reason : null;
  const error = localError ?? serverError ?? null;
  const length = [...value.trim()].length;
  return (
    <div className="field">
      <label htmlFor={id}>Nickname</label>
      <input
        id={id}
        className={`input${error ? " has-error" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="nickname"
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        maxLength={NICKNAME_MAX_LENGTH * 2}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        autoFocus={autoFocus}
      />
      <div id={`${id}-hint`} className="field-hint" aria-live="polite">
        {error ? (
          <span className="field-error">
            <Icon name="warn" size={15} />
            {error}
          </span>
        ) : (
          <span>
            {length}/{NICKNAME_MAX_LENGTH} · letters, numbers, spaces and basic punctuation
          </span>
        )}
      </div>
    </div>
  );
}
