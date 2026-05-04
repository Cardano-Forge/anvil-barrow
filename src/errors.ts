import { parseError } from "trynot";
import type { RunnerDef } from "./types";

export class SocketClosedError extends Error {
  constructor(
    public readonly code: number,
    public readonly reason: string,
    message: string,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
    this.name = "SocketClosedError";
  }
}

export class SocketError extends Error {
  constructor(message: string, opts?: ErrorOptions) {
    super(message, opts);
    this.name = "SocketError";
  }
}

export class ProcessingError<TRunner extends RunnerDef> extends Error {
  constructor(
    public readonly event: TRunner["event"],
    originalError: unknown,
  ) {
    super(parseError(originalError).message, { cause: originalError });
    this.name = "ProcessingError";
  }
}
