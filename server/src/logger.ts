/**
 * Plain one-line logs (`LEVEL event key=value ...`) that read well in Render's
 * log viewer, which adds its own timestamps. Never log roles, session tokens or
 * chat text.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields, err?: unknown): void;
}

export function formatLog(level: string, event: string, fields: LogFields = {}): string {
  const parts = [level.toUpperCase(), event];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const text = String(value);
    parts.push(`${key}=${text === "" || /[\s"=]/.test(text) ? JSON.stringify(text) : text}`);
  }
  return parts.join(" ");
}

export function createConsoleLogger(): Logger {
  return {
    info: (event, fields) => console.log(formatLog("info", event, fields)),
    warn: (event, fields) => console.warn(formatLog("warn", event, fields)),
    error: (event, fields, err) => {
      const message = err instanceof Error ? err.message : err === undefined ? undefined : String(err);
      const line = formatLog("error", event, { ...fields, error: message });
      console.error(err instanceof Error && err.stack ? `${line}\n${err.stack}` : line);
    },
  };
}

/** Keeps lines in memory (tests). */
export function createMemoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (event, fields) => lines.push(formatLog("info", event, fields)),
    warn: (event, fields) => lines.push(formatLog("warn", event, fields)),
    error: (event, fields, err) =>
      lines.push(formatLog("error", event, { ...fields, error: err instanceof Error ? err.message : String(err) })),
  };
}
