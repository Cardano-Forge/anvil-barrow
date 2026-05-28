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

export class AbortError extends Error {
  constructor(message: string, opts?: ErrorOptions) {
    super(message, opts);
    this.name = "AbortError";
  }
}

export class ProcessingError<TDef extends RunnerDef> extends Error {
  constructor(
    public readonly event: TDef["event"],
    originalError: unknown,
  ) {
    super(parseError(originalError).message, { cause: originalError });
    this.name = "ProcessingError";
  }
}
