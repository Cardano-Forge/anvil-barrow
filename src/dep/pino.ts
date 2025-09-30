import type { Logger } from "pino";
import type { ControllerEvent } from "../controller";
import { getLogLevel } from "../logs";
import type { Schema } from "../types";

export function pinoEventLogger<TSchema extends Schema>(logger: Logger) {
  return (event: ControllerEvent<TSchema>) => {
    const level = getLogLevel(event);
    logger[level](event.data, event.type);
  };
}
