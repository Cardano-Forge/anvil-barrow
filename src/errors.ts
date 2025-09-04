import type { SyncEvent } from "./types";

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

export class ProcessingError extends Error {
  constructor(
    public readonly event: SyncEvent,
    message: string,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
    this.name = "ProcessingError";
  }
}
