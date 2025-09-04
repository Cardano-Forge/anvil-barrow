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
  startOpts: Omit<ControllerStartOpts, "point">;
  startingPoint: Schema.PointOrOrigin | undefined;
  syncTip: Schema.Point | Schema.TipOrOrigin | undefined;
  chainTip: Schema.TipOrOrigin | undefined;
  applyCount: number;
  resetCount: number;
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
  status: "paused" | "done" | "crashed";
  stoppedAt: number;
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

        const processedCount = this._state.applyCount + this._state.resetCount;
        if (processedCount === 0 && !this._state.startingPoint) {
          this._state.startingPoint = this._state.syncTip;
        }

        switch (event.type) {
          case "apply": {
            this._state.applyCount += 1;
            break;
          }
          case "reset": {
            this._state.resetCount += 1;
            break;
          }
        }

        this._config.errorHandler.reset();

        if (opts.take && this._state.applyCount >= opts.take) {
          break;
        }

        if (opts.throttle) {
          await new Promise((resolve) => setTimeout(resolve, opts.throttle));
        }
      }

      this._state = {
        status:
          opts.take && this._state.applyCount >= opts.take ? "done" : "paused",
        startOpts: this._state.startOpts,
        startingPoint: this._state.startingPoint,
        syncTip: this._state.syncTip,
        chainTip: this._state.chainTip,
        applyCount: this._state.applyCount,
        resetCount: this._state.resetCount,
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

          this._state.generator = this._config.syncClient.sync({
            point: this._state.syncTip ?? this._state.startingPoint,
          });

          return this._runSyncLoop(opts);
        }
      }

      this._state = {
        status: "crashed",
        startOpts: this._state.startOpts,
        startingPoint: this._state.startingPoint,
        syncTip: this._state.syncTip,
        chainTip: this._state.chainTip,
        applyCount: this._state.applyCount,
        resetCount: this._state.resetCount,
        errorCount: this._state.errorCount,
        lastError: this._state.lastError,
        stoppedAt: Date.now(),
      };
    }
  }

  get state(): ControllerState {
    return this._state;
  }

  async start(
    opts: ControllerStartOpts,
  ): Promise<Result<ControllerStateRunning>> {
    switch (this._state.status) {
      case "running": {
        return new Error("Controller is already running");
      }
    }

    const { point, ...startOpts } = opts;

    this._state = {
      status: "running",
      startOpts,
      generator: this._config.syncClient.sync({ point }),
      promise: Promise.resolve(),
      startingPoint: point,
      syncTip: undefined,
      chainTip: undefined,
      applyCount: 0,
      resetCount: 0,
      errorCount: 0,
      lastError: undefined,
    };

    this._state.promise = this._runSyncLoop(startOpts);

    return this._state;
  }

  async waitForCompletion(): Promise<Result<void>> {
    switch (this._state.status) {
      case "running": {
        return wrap(this._state.promise);
      }
      default: {
        return new Error("Controller is not running");
      }
    }
  }

  async pause(): Promise<Result<ControllerStateStopped>> {
    switch (this._state.status) {
      case "running": {
        try {
          await this._state.generator.return();
          await this._state.promise;
        } catch (error) {
          return parseError(error);
        }
      }
    }

    switch (this._state.status) {
      case "paused": {
        return this._state;
      }
      default: {
        return new Error(
          `Controller is ${this._state.status}. Nothing to pause`,
        );
      }
    }
  }

  async resume(): Promise<Result<ControllerStateRunning>> {
    switch (this._state.status) {
      case "paused": {
        this._state = {
          status: "running",
          startOpts: this._state.startOpts,
          generator: this._config.syncClient.sync({
            point: this._state.syncTip ?? this._state.startingPoint,
          }),
          promise: Promise.resolve(),
          startingPoint: this._state.startingPoint,
          syncTip: this._state.syncTip,
          chainTip: this._state.chainTip,
          applyCount: this._state.applyCount,
          resetCount: this._state.resetCount,
          errorCount: this._state.errorCount,
          lastError: this._state.lastError,
        };

        this._state.promise = this._runSyncLoop(this._state.startOpts);

        return this._state;
      }
      default: {
        return new Error(
          `Controller is ${this._state.status}. Nothing to resume`,
        );
      }
    }
  }
}
