import type { Level, Logger } from "pino";
import type { ControllerEvent } from "../controller";
import type { Schema } from "../types";

export function controllerLogger<TSchema extends Schema>(logger: Logger) {
  return (event: ControllerEvent<TSchema>) => {
    logger[getLogLevel(event)](event.data, event.type);
  };
}

export function getLogLevel<TSchema extends Schema>(
  event: ControllerEvent<TSchema>,
): Level {
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
