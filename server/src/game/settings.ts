import {
  CONTENT_MODES,
  MAX_MAFIA_SETTING,
  OPTIONAL_ROLES,
  TIE_RULES,
  TIMER_LIMITS,
  type GameSettings,
  type OptionalRole,
  type TimerSettings,
} from "@mafia/shared";

export type SettingsResult = { ok: true; settings: GameSettings } | { ok: false; message: string };

const bad = (message: string): SettingsResult => ({ ok: false, message });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/**
 * Applies a (possibly untrusted) partial settings object on top of `current`.
 * Rejects the whole patch if any part of it is invalid.
 */
export function mergeSettings(current: GameSettings, patch: unknown): SettingsResult {
  if (!isRecord(patch)) return bad("Settings must be an object.");
  const next = structuredClone(current);

  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case "contentMode":
        if (!isOneOf(CONTENT_MODES, value)) return bad("Content mode must be safe or normal.");
        next.contentMode = value;
        break;
      case "tieRule":
        if (!isOneOf(TIE_RULES, value)) return bad("Tie rule must be no_elimination or revote.");
        next.tieRule = value;
        break;
      case "revealRoleOnDeath":
        if (typeof value !== "boolean") return bad("revealRoleOnDeath must be true or false.");
        next.revealRoleOnDeath = value;
        break;
      case "showVotes":
        if (typeof value !== "boolean") return bad("showVotes must be true or false.");
        next.showVotes = value;
        break;
      case "announceSaves":
        if (typeof value !== "boolean") return bad("announceSaves must be true or false.");
        next.announceSaves = value;
        break;
      case "profanityFilter":
        if (typeof value !== "boolean") return bad("profanityFilter must be true or false.");
        next.profanityFilter = value;
        break;
      case "sneakyGang":
        if (typeof value !== "boolean") return bad("sneakyGang must be true or false.");
        next.sneakyGang = value;
        break;
      case "aiNarrator":
        if (typeof value !== "boolean") return bad("aiNarrator must be true or false.");
        next.aiNarrator = value;
        break;
      case "mafiaCount":
        if (value === "auto") {
          next.mafiaCount = "auto";
        } else if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_MAFIA_SETTING) {
          next.mafiaCount = value;
        } else {
          return bad(`Mafia count must be "auto" or a whole number from 1 to ${MAX_MAFIA_SETTING}.`);
        }
        break;
      case "optionalRoles": {
        if (!isRecord(value)) return bad("optionalRoles must be an object.");
        for (const [role, on] of Object.entries(value)) {
          if (!isOneOf(OPTIONAL_ROLES, role) || typeof on !== "boolean") {
            return bad(`Unknown optional role setting "${role}".`);
          }
          next.optionalRoles[role as OptionalRole] = on;
        }
        break;
      }
      case "timers": {
        if (!isRecord(value)) return bad("timers must be an object.");
        for (const [name, seconds] of Object.entries(value)) {
          if (!Object.hasOwn(TIMER_LIMITS, name)) return bad(`Unknown timer "${name}".`);
          const timer = name as keyof TimerSettings;
          const { min, max } = TIMER_LIMITS[timer];
          if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < min || seconds > max) {
            return bad(`${timer} must be a whole number from ${min} to ${max} seconds.`);
          }
          next.timers[timer] = seconds;
        }
        break;
      }
      default:
        return bad(`Unknown setting "${key}".`);
    }
  }

  // Safe Mode always filters chat. Asking for it off is refused; a stored "off" from
  // Normal Mode is simply switched back on when the host moves to Safe Mode.
  if (next.contentMode === "safe") {
    if (Object.hasOwn(patch, "profanityFilter") && patch.profanityFilter === false) {
      return bad("The chat filter is always on in Safe Mode.");
    }
    next.profanityFilter = true;
  }
  return { ok: true, settings: next };
}
