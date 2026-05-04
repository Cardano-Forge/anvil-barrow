import type { Logger } from "pino";
import type { LogEvent } from "../controller";
import { getLogLevel } from "../logs";
import type { RunnerDef } from "../types";

export class PinoLogger<TDef extends RunnerDef> {
  constructor(private logger: Logger) {}

  log(logEvent: LogEvent<TDef>) {
    const level = getLogLevel(logEvent);
    this.logger[level](logEvent.data, logEvent.type);
  }
}
