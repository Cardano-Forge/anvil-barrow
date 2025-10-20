import type { LogEvent } from "./controller";
import type { Schema } from "./types";

export const logLevels = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

export type LogLevel = (typeof logLevels)[number];

export function getLogLevel<TSchema extends Schema>(
  logEvent: LogEvent<TSchema>,
): LogLevel {
  switch (logEvent.type) {
    case "event.received":
    case "event.processing": {
      return "trace";
    }
    case "event.filtered":
    case "event.processed":
    case "throttle.delay": {
      return "debug";
    }
    case "controller.started":
    case "controller.resumed":
    case "retry.started": {
      return "info";
    }
    case "controller.paused":
    case "error.handled":
    case "retry.scheduled": {
      return "warn";
    }
    case "error.caught": {
      return "error";
    }
    case "controller.completed": {
      return logEvent.data.status === "crashed" ? "error" : "info";
    }
    default: {
      return "info";
    }
  }
}
