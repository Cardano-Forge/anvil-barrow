import type { Schema } from "@cardano-ogmios/client";
import { parseError, type Result } from "trynot";
import type { SyncClient, SyncEvent } from "./types";

export type ControllerConfig = {
  syncClient: SyncClient;
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
  protected _state: ControllerState = { status: "idle" };

  constructor(protected _config: ControllerConfig) {}

  async start(opts: ControllerStartOpts): Promise<Result<void>> {
    switch (this._state.status) {
      case "running":
      case "paused": {
        return new Error("Controller is already running");
      }
    }

    this._state = {
      status: "running",
      generator: this._config.syncClient.sync({
        points: opts.point ? [opts.point] : undefined,
      }),
      startingPoint: opts.point,
      syncTip: undefined,
      chainTip: undefined,
      processed: 0,
    };

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
        this._state.processed++;

        if (opts.take && this._state.processed >= opts.take) {
          this.stop();
        }

        if (opts.throttle) {
          await new Promise((resolve) => setTimeout(resolve, opts.throttle));
        }
      }
    } catch (error) {
      return parseError(error);
    }
  }

  stop(): Result<ControllerStateStopped> {
    switch (this._state.status) {
      case "idle": {
        return new Error("Controller is idle");
      }
      case "stopped": {
        return new Error("Controller is already stopped");
      }
      case "running":
      case "paused": {
        this._state.generator.return();
        this._state = {
          status: "stopped",
          startingPoint: this._state.startingPoint,
          syncTip: this._state.syncTip,
          chainTip: this._state.chainTip,
          processed: this._state.processed,
          stoppedAt: Date.now(),
        };
        return this._state;
      }
    }
  }
}
