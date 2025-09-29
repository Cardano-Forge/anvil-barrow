import { parseError } from "trynot";
import type { Schema, SyncEvent } from "./types";

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

type ProcessingErrorEvent<TSchema extends Schema> =
  | { type: "apply"; block: TSchema["point"] | TSchema["tipOrOrigin"] }
  | { type: "reset"; point: TSchema["pointOrOrigin"] };

export class ProcessingError<TSchema extends Schema> extends Error {
  constructor(
    public readonly event: ProcessingErrorEvent<TSchema>,
    message: string,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
    this.name = "ProcessingError";
  }

  static fromSyncEvent<TSchema extends Schema>(
    event: SyncEvent<TSchema>,
    originalError: unknown,
  ): ProcessingError<TSchema> {
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
