import type { Schema } from "@cardano-ogmios/client";
import { assert, parseError, type Result, wrap } from "trynot";
import { ErrorHandler, type HandlerResult } from "./error-handler";
import { ProcessingError } from "./errors";
import { toMilliseconds, type Unit } from "./time";
import type { MaybePromise, SyncClient, SyncEvent } from "./types";

export type ControllerStats = {
  applyCount: number;
  resetCount: number;
  filterCount: number;
  errorCount: number;
};

export type ControllerEvent =
  | {
      type: "controller.started";
      timestamp: number;
      data: {
        point?: Schema.PointOrOrigin;
        startOpts: Omit<ControllerStartOpts, "point">;
      };
    }
  | {
      type: "controller.paused";
      timestamp: number;
      data: {
        reason: "user_requested" | "error_limit";
        stats: ControllerStats;
      };
    }
  | {
      type: "controller.resumed";
      timestamp: number;
      data: {
        resumePoint?: Schema.PointOrOrigin;
        stats: ControllerStats;
      };
    }
  | {
      type: "controller.completed";
      timestamp: number;
      data: {
        status: "done" | "crashed";
        stats: ControllerStats;
        lastError?: Error;
      };
    }
  | {
      type: "event.received" | "event.filtered" | "event.processing";
      timestamp: number;
      data: {
        event: SyncEvent["type"];
      };
    }
  | {
      type: "event.processed";
      timestamp: number;
      data: {
        event: SyncEvent["type"];
        result?: { done: boolean } | undefined;
        processingTime: number;
      };
    }
  | {
      type: "throttle.delay";
      timestamp: number;
      data: {
        delay: number;
        unit: Unit;
      };
    }
  | {
      type: "error.caught";
      timestamp: number;
      data: {
        error: Error;
        event?: SyncEvent["type"];
        context: "processing" | "sync_loop" | "generator";
      };
    }
  | {
      type: "error.handled";
      timestamp: number;
      data: {
        error: Error;
        handlerResult?: HandlerResult;
      };
    }
  | {
      type: "retry.scheduled";
      timestamp: number;
      data: {
        delay: number;
        attempt: number;
        originalError: Error;
      };
    }
  | {
      type: "retry.started";
      timestamp: number;
      data: {
        attempt: number;
        resumePoint?: Schema.PointOrOrigin;
        originalError: Error;
      };
    };

export type ControllerConfig = {
  syncClient: SyncClient;
  errorHandler?: ErrorHandler;
  eventHandler?: (event: ControllerEvent) => void;
};

export type ControllerStartOpts = {
  fn: (
    event: SyncEvent,
    // biome-ignore lint/suspicious/noConfusingVoidType: Allow void for better DX
  ) => MaybePromise<{ done: boolean } | undefined | void>;
  point?: Schema.PointOrOrigin;
  throttle?: [number, Unit];
  filter?: (event: SyncEvent) => MaybePromise<boolean>;
  takeUntil?: (data: {
    lastEvent: SyncEvent;
    state: ControllerStateRunning;
  }) => MaybePromise<boolean>;
};

export type ControllerStateBase = {
  startOpts: Omit<ControllerStartOpts, "point">;
  startingPoint: Schema.PointOrOrigin | undefined;
  syncTip: Schema.Point | Schema.TipOrOrigin | undefined;
  chainTip: Schema.TipOrOrigin | undefined;
  filterCount: number;
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
      eventHandler: config.eventHandler ?? (() => {}),
    };
  }

  private _emitEvent(event: Omit<ControllerEvent, "timestamp">): void {
    try {
      this._config.eventHandler({
        ...event,
        timestamp: Date.now(),
      } as ControllerEvent);
    } catch {
      // Silently ignore event handler errors to prevent disrupting controller flow
    }
  }

  private async _runSyncLoop(
    opts: Omit<ControllerStartOpts, "point">,
  ): Promise<void> {
    assert(this._state.status === "running");

    try {
      let done = false;

      for await (const event of this._state.generator) {
        this._emitEvent({
          type: "event.received",
          data: { event: event.type },
        });

        try {
          if (opts.filter && !(await opts.filter(event))) {
            this._state.filterCount += 1;
            this._emitEvent({
              type: "event.filtered",
              data: { event: event.type },
            });
            continue;
          }

          this._emitEvent({
            type: "event.processing",
            data: { event: event.type },
          });

          const processingStart = Date.now();

          const res = await opts.fn(event);

          const processingTime = Date.now() - processingStart;

          this._emitEvent({
            type: "event.processed",
            data: {
              event: event.type,
              result: res ?? undefined,
              processingTime,
            },
          });

          this._state.chainTip = event.tip;
          if (event.type === "apply" && event.block.type !== "ebb") {
            this._state.syncTip = {
              slot: event.block.slot,
              id: event.block.id,
              height: event.block.height,
            };
          }

          const processedCount =
            this._state.applyCount + this._state.resetCount;
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

          if (
            res?.done ||
            (await opts.takeUntil?.({ lastEvent: event, state: this._state }))
          ) {
            done = true;
            break;
          }

          if (opts.throttle) {
            const [value, unit] = opts.throttle;
            const delay = toMilliseconds(value, unit);

            this._emitEvent({
              type: "throttle.delay",
              data: { delay, unit },
            });

            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } catch (error) {
          throw ProcessingError.fromSyncEvent(event, error);
        }
      }

      const status = done ? "done" : "paused";
      const stoppedAt = Date.now();

      this._state = {
        status,
        startOpts: this._state.startOpts,
        startingPoint: this._state.startingPoint,
        syncTip: this._state.syncTip,
        chainTip: this._state.chainTip,
        filterCount: this._state.filterCount,
        applyCount: this._state.applyCount,
        resetCount: this._state.resetCount,
        errorCount: this._state.errorCount,
        lastError: this._state.lastError,
        stoppedAt,
      };

      if (status === "done") {
        this._emitEvent({
          type: "controller.completed",
          data: {
            status: "done",
            stats: {
              applyCount: this._state.applyCount,
              resetCount: this._state.resetCount,
              filterCount: this._state.filterCount,
              errorCount: this._state.errorCount,
            },
          },
        });
      }
    } catch (error) {
      const parsedError = parseError(error);
      this._state.errorCount += 1;
      this._state.lastError = parsedError;

      this._emitEvent({
        type: "error.caught",
        data: { error: parsedError, context: "sync_loop" },
      });

      if (this._state.status === "running") {
        const handlerResult = await this._config.errorHandler.handle(error);

        this._emitEvent({
          type: "error.handled",
          data: { error: parsedError, handlerResult },
        });

        if (handlerResult?.retry) {
          if (handlerResult.retry.delay) {
            this._emitEvent({
              type: "retry.scheduled",
              data: {
                delay: handlerResult.retry.delay,
                attempt: this._state.errorCount,
                originalError: parsedError,
              },
            });
            await new Promise((resolve) => {
              setTimeout(resolve, handlerResult.retry?.delay);
            });
          }

          const resumePoint = this._state.syncTip ?? this._state.startingPoint;

          this._emitEvent({
            type: "retry.started",
            data: {
              attempt: this._state.errorCount,
              resumePoint,
              originalError: parsedError,
            },
          });

          this._state.generator = this._config.syncClient.sync({
            point: resumePoint,
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
        filterCount: this._state.filterCount,
        applyCount: this._state.applyCount,
        resetCount: this._state.resetCount,
        errorCount: this._state.errorCount,
        lastError: this._state.lastError,
        stoppedAt: Date.now(),
      };

      this._emitEvent({
        type: "controller.completed",
        data: {
          status: "crashed",
          stats: {
            applyCount: this._state.applyCount,
            resetCount: this._state.resetCount,
            filterCount: this._state.filterCount,
            errorCount: this._state.errorCount,
          },
          lastError: this._state.lastError,
        },
      });
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
      filterCount: 0,
      applyCount: 0,
      resetCount: 0,
      errorCount: 0,
      lastError: undefined,
    };

    this._emitEvent({
      type: "controller.started",
      data: {
        point,
        startOpts,
      },
    });

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
        this._emitEvent({
          type: "controller.paused",
          data: {
            reason: "user_requested",
            stats: {
              applyCount: this._state.applyCount,
              resetCount: this._state.resetCount,
              filterCount: this._state.filterCount,
              errorCount: this._state.errorCount,
            },
          },
        });
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
          filterCount: this._state.filterCount,
          applyCount: this._state.applyCount,
          resetCount: this._state.resetCount,
          errorCount: this._state.errorCount,
          lastError: this._state.lastError,
        };

        this._emitEvent({
          type: "controller.resumed",
          data: {
            resumePoint: this._state.syncTip ?? this._state.startingPoint,
            stats: {
              applyCount: this._state.applyCount,
              resetCount: this._state.resetCount,
              filterCount: this._state.filterCount,
              errorCount: this._state.errorCount,
            },
          },
        });

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
