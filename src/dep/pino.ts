import type { Logger } from "pino";
import type { LogEvent } from "../controller";
import { getLogLevel } from "../logs";
import type { Schema } from "../types";

export function pinoLogger<TSchema extends Schema>(logger: Logger) {
  return (logEvent: LogEvent<TSchema>) => {
    const level = getLogLevel(logEvent);
    logger[level](logEvent.data, logEvent.type);
  };
}
