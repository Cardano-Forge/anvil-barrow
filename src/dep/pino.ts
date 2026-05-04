import type { Logger } from "pino";
import type { LogEvent } from "../controller";
import { getLogLevel } from "../logs";
import type { RunnerDef } from "../types";

export function pinoLogger<TRunner extends RunnerDef>(logger: Logger) {
  return (logEvent: LogEvent<TRunner>) => {
    const level = getLogLevel(logEvent);
    logger[level](logEvent.data, logEvent.type);
  };
}
