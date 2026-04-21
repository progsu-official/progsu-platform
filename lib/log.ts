import { randomUUID } from "node:crypto";

type Level = "debug" | "info" | "warn" | "error";

type LogFields = {
  action?: string;
  user_id?: string;
  request_id?: string;
  duration_ms?: number;
  ok?: boolean;
  error_code?: string;
  [key: string]: unknown;
};

function emit(level: Level, message: string, fields: LogFields = {}) {
  const entry = {
    level,
    ts: new Date().toISOString(),
    message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: LogFields) => emit("debug", msg, f),
  info: (msg: string, f?: LogFields) => emit("info", msg, f),
  warn: (msg: string, f?: LogFields) => emit("warn", msg, f),
  error: (msg: string, f?: LogFields) => emit("error", msg, f),
};

export function newRequestId(): string {
  return randomUUID();
}
