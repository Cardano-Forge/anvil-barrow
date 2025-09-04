import type { Schema } from "@cardano-ogmios/client";
import { parseError } from "trynot";
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

type ProcessingErrorEvent =
  | { type: "apply"; block: Schema.Point | Schema.TipOrOrigin }
  | { type: "reset"; point: Schema.PointOrOrigin };

export class ProcessingError extends Error {
  constructor(
    public readonly event: ProcessingErrorEvent,
    message: string,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
    this.name = "ProcessingError";
  }

  static fromSyncEvent(
    event: SyncEvent,
    originalError: unknown,
  ): ProcessingError {
    return new ProcessingError(
      event.type === "apply"
        ? {
            type: "apply",
            block: {
              id: event.block.id,
              slot: event.block.height,
              height: event.block.height,
            },
          }
        : { type: "reset", point: event.point },
      parseError(originalError).message,
      { cause: originalError },
    );
  }
}
