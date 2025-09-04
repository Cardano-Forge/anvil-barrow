import type { Schema } from "@cardano-ogmios/client";
import { assert, parseError, type Result, wrap } from "trynot";
import { ErrorHandler } from "./error-handler";
import type { SyncClient, SyncEvent } from "./types";

export type ControllerConfig = {
  syncClient: SyncClient;
  errorHandler?: ErrorHandler;
};

export type ControllerStartOpts = {
  fn: (event: SyncEvent) => Promise<void> | void;
  point?: Schema.PointOrOrigin;
  take?: number;
  throttle?: number;
};

export type ControllerStateBase = {
  startingPoint: Schema.PointOrOrigin | undefined;
  syncTip: Schema.TipOrOrigin | undefined;
  chainTip: Schema.TipOrOrigin | undefined;
  processedCount: number;
  errorCount: number;
  lastError: Error | undefined;
};

export type ControllerStateIdle = { status: "idle" };

export type ControllerStateRunning = {
  status: "running";
  generator: AsyncGenerator<SyncEvent, void>;
  promise: Promise<void>;
} & ControllerStateBase;

export type ControllerStateStopped = {
  status: "stopped" | "crashed";
  stoppedAt: number;
  stoppedWithError?: Error;
} & ControllerStateBase;

export type ControllerState =
  | ControllerStateIdle
  | ControllerStateRunning
  | ControllerStateStopped;

export class Controller {
  protected _state: ControllerState;
  protected _config: Required<ControllerConfig>;

  constructor(config: ControllerConfig) {
    this._state = { status: "idle" };
    this._config = {
      syncClient: config.syncClient,
      errorHandler:
        config.errorHandler ??
        new ErrorHandler((error) => {
          console.error(parseError(error).message);
          return undefined;
        }),
    };
  }

  private async _runSyncLoop(
    opts: Omit<ControllerStartOpts, "point">,
  ): Promise<void> {
    assert(this._state.status === "running");

    try {
      for await (const event of this._state.generator) {
        await opts.fn(event);

        this._state.chainTip = event.tip;
        if (event.type === "apply" && event.block.type !== "ebb") {
          this._state.syncTip = {
            slot: event.block.slot,
            id: event.block.id,
            height: event.block.height,
          };
        }
        if (this._state.processedCount === 0 && !this._state.startingPoint) {
          this._state.startingPoint = this._state.syncTip;
        }

        this._state.processedCount += 1;

        this._config.errorHandler.reset();

        if (opts.take && this._state.processedCount >= opts.take) {
          break;
        }

        if (opts.throttle) {
          await new Promise((resolve) => setTimeout(resolve, opts.throttle));
        }
      }

      this._state = {
        status: "stopped",
        startingPoint: this._state.startingPoint,
        syncTip: this._state.syncTip,
        chainTip: this._state.chainTip,
        processedCount: this._state.processedCount,
        errorCount: this._state.errorCount,
        lastError: this._state.lastError,
        stoppedAt: Date.now(),
      };
    } catch (error) {
      this._state.errorCount += 1;
      this._state.lastError = parseError(error);

      if (this._state.status === "running") {
        const handlerResult = await this._config.errorHandler.handle(error);
        if (handlerResult?.retry) {
          if (handlerResult.retry.delay) {
            await new Promise((resolve) => {
              setTimeout(resolve, handlerResult.retry?.delay);
            });
          }
          const points = this._state.syncTip
            ? [this._state.syncTip]
            : undefined;
          this._state.generator = this._config.syncClient.sync({ points });
          return this._runSyncLoop(opts);
        }
      }

      this._state = {
        status: "crashed",
        startingPoint: this._state.startingPoint,
        syncTip: this._state.syncTip,
        chainTip: this._state.chainTip,
        processedCount: this._state.processedCount,
        errorCount: this._state.errorCount,
        lastError: this._state.lastError,
        stoppedAt: Date.now(),
      };
    }
  }

  get state(): ControllerState {
    return this._state;
  }

  async start({
    point,
    ...opts
  }: ControllerStartOpts): Promise<Result<ControllerStateRunning>> {
    switch (this._state.status) {
      case "running": {
        return new Error("Controller is already running");
      }
    }

    const points = point ? [point] : undefined;

    this._state = {
      status: "running",
      generator: this._config.syncClient.sync({ points }),
      promise: Promise.resolve(),
      startingPoint: point,
      syncTip: undefined,
      chainTip: undefined,
      processedCount: 0,
      errorCount: 0,
      lastError: undefined,
    };

    this._state.promise = this._runSyncLoop(opts);

    return this._state;
  }

  async waitForCompletion(): Promise<Result<void>> {
    switch (this._state.status) {
      case "idle": {
        return new Error("Controller is idle");
      }
      case "stopped":
      case "crashed": {
        return new Error("Controller is already stopped");
      }
      case "running": {
        return wrap(this._state.promise);
      }
    }
  }

  async stop(): Promise<Result<ControllerStateStopped>> {
    switch (this._state.status) {
      case "idle": {
        return new Error("Controller is idle");
      }
      case "stopped":
      case "crashed": {
        return this._state;
      }
      case "running": {
        try {
          await this._state.generator.return();
          return await this._state.promise.then(() => {
            if (this._state.status !== "stopped") {
              return new Error("Controller did not stop");
            }
            return this._state;
          });
        } catch (error) {
          return parseError(error);
        }
      }
    }
  }
}
