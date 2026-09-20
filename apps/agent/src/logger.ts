/**
 * Structured logging with no dependency.
 *
 * One line of JSON per event, with the incident id on everything that belongs
 * to an incident, so a whole fire can be pulled out of a production log with a
 * single grep. Colourised only when a human is watching a terminal.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;
const pretty = process.env.NODE_ENV !== "production" && process.stdout.isTTY;

const CSI = `${String.fromCharCode(27)}[`;
const RESET = `${CSI}0m`;
const DIM = `${CSI}90m`;
const COLOURS: Record<Level, string> = {
  debug: `${CSI}90m`,
  info: `${CSI}36m`,
  warn: `${CSI}33m`,
  error: `${CSI}31m`,
};

/** A log line must never be the thing that throws. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{"error":"unserialisable log payload"}';
  }
}

function emit(level: Level, scope: string, message: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const at = new Date().toISOString();

  if (pretty) {
    const time = at.slice(11, 19);
    const details =
      data && Object.keys(data).length > 0 ? ` ${DIM}${safeJson(data)}${RESET}` : "";
    process.stdout.write(
      `${COLOURS[level]}${level.toUpperCase().padEnd(5)}${RESET} ${DIM}${time}${RESET} [${scope}] ${message}${details}\n`,
    );
    return;
  }

  process.stdout.write(safeJson({ at, level, scope, message, ...data }) + "\n");
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, data) => emit("debug", scope, message, data),
    info: (message, data) => emit("info", scope, message, data),
    warn: (message, data) => emit("warn", scope, message, data),
    error: (message, data) => emit("error", scope, message, data),
    child: (child) => createLogger(`${scope}:${child}`),
  };
}

export const log = createLogger("arca");

/** Errors reach a log as a message, never as an unreadable object. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return safeJson(error);
}
