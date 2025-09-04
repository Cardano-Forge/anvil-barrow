import type { Schema } from "@cardano-ogmios/client";
import { assert, parseError, type Result, wrap } from "trynot";
import type { SyncClient, SyncEvent } from "./types";

export type ControllerConfig = {
  syncClient: SyncClient;
  onError?: (error: Error) => void;
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
  processed: number;
};

export type ControllerStateIdle = { status: "idle" };

export type ControllerStateRunning = {
  status: "running" | "paused";
  generator: AsyncGenerator<SyncEvent, void>;
  promise: Promise<void>;
} & ControllerStateBase;

export type ControllerStateStopped = {
  status: "stopped";
  stoppedAt: number;
} & ControllerStateBase;

export type ControllerState =
  | ControllerStateIdle
  | ControllerStateRunning
  | ControllerStateStopped;

export class Controller {
  protected _state: ControllerState;

  constructor(protected _config: ControllerConfig) {
    this._state = { status: "idle" };
  }

  private async _runSyncLoop(opts: ControllerStartOpts): Promise<void> {
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
        if (this._state.processed === 0 && !this._state.startingPoint) {
          this._state.startingPoint = this._state.syncTip;
        }

        this._state.processed += 1;

        if (opts.take && this._state.processed >= opts.take) {
          break;
        }

        if (opts.throttle) {
          await new Promise((resolve) => setTimeout(resolve, opts.throttle));
        }
      }
    } catch (error) {
      if (this._config.onError) {
        this._config.onError(parseError(error));
      } else {
        console.error(parseError(error).message);
      }
    } finally {
      this._state = {
        status: "stopped",
        startingPoint: this._state.startingPoint,
        syncTip: this._state.syncTip,
        chainTip: this._state.chainTip,
        processed: this._state.processed,
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
      case "running":
      case "paused": {
        return new Error("Controller is already running");
      }
    }

    const points = opts.point ? [opts.point] : undefined;

    this._state = {
      status: "running",
      generator: this._config.syncClient.sync({ points }),
      promise: Promise.resolve(),
      startingPoint: opts.point,
      syncTip: undefined,
      chainTip: undefined,
      processed: 0,
    };

    this._state.promise = this._runSyncLoop(opts);

    return this._state;
  }

  async waitForCompletion(): Promise<Result<void>> {
    switch (this._state.status) {
      case "idle": {
        return new Error("Controller is idle");
      }
      case "stopped": {
        return new Error("Controller is already stopped");
      }
      case "running":
      case "paused": {
        return wrap(this._state.promise);
      }
    }
  }

  async stop(): Promise<Result<ControllerStateStopped>> {
    switch (this._state.status) {
      case "idle": {
        return new Error("Controller is idle");
      }
      case "stopped": {
        return this._state;
      }
      case "running":
      case "paused": {
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
