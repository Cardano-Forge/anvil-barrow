import type { Logger } from "pino";
import type { LogEvent } from "../controller";
import { getLogLevel } from "../logs";
import type { RunnerDef } from "../types";

export function pinoLogger<TDef extends RunnerDef>(logger: Logger) {
  return (logEvent: LogEvent<TDef>) => {
    const level = getLogLevel(logEvent);
    logger[level](logEvent.data, logEvent.type);
  };
}
