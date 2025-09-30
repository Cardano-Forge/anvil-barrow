import type { ControllerEvent } from "./controller";
import type { Schema } from "./types";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export function getLogLevel<TSchema extends Schema>(
  event: ControllerEvent<TSchema>,
): LogLevel {
  switch (event.type) {
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
      return event.data.status === "crashed" ? "error" : "info";
    }
    default: {
      return "info";
    }
  }
}
