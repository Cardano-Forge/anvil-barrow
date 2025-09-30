import { assert, parseError, type Result, wrap } from "trynot";
import { ErrorHandler, type HandlerResult } from "./error-handler";
import { ProcessingError } from "./errors";
import { noop } from "./lib/noop";
import { toMilliseconds, type Unit } from "./time";
import type { TracingConfig } from "./tracing";
import type { MaybePromise, Schema, SyncClient, SyncEvent } from "./types";

export class Controller<TSchema extends Schema = Schema> {
  protected _state: ControllerState<TSchema> = {
    status: "idle",
  };

  protected _config: Required<ControllerConfig<TSchema>>;

  constructor(config: ControllerConfig<TSchema>) {
    this._config = {
      syncClient: config.syncClient,
      errorHandler: config.errorHandler ?? new ErrorHandler(),
      logger: config.logger ?? noop,
      tracingConfig: config.tracingConfig ?? {},
    };

    this._config.tracingConfig.metrics?.status?.record(
      controllerStatuses.indexOf(this._state.status),
    );
  }

  get state(): ControllerState<TSchema> {
    return this._state;
  }

  async start(
    opts: ControllerStartOpts<TSchema>,
  ): Promise<Result<ControllerStateRunning<TSchema>>> {
    switch (this._state.status) {
      case "running": {
        return new Error("Controller is already running");
      }
    }

    const { point, ...startOpts } = opts;

    this._state = {
      status: "running",
      generator: this._config.syncClient.sync({ point }),
      promise: Promise.resolve(),
      meta: {
        startOpts,
        startingPoint: point,
        syncTip: undefined,
        chainTip: undefined,
        lastError: undefined,
      },
      counters: {
        filterCount: 0,
        applyCount: 0,
        resetCount: 0,
        errorCount: 0,
      },
    };

    this._config.tracingConfig.metrics?.status?.record(
      controllerStatuses.indexOf(this._state.status),
    );
    this._config.tracingConfig.metrics?.isSynced?.record(0);
    this._config.tracingConfig.metrics?.syncTipSlot?.record(0);
    this._config.tracingConfig.metrics?.syncTipHeight?.record(0);
    this._config.tracingConfig.metrics?.chainTipSlot?.record(0);
    this._config.tracingConfig.metrics?.chainTipHeight?.record(0);
    this._config.tracingConfig.metrics?.filterCount?.record(0);
    this._config.tracingConfig.metrics?.applyCount?.record(0);
    this._config.tracingConfig.metrics?.resetCount?.record(0);
    this._config.tracingConfig.metrics?.errorCount?.record(0);

    this._emitLogEvent({
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

  async pause(): Promise<Result<ControllerStateStopped<TSchema>>> {
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
        this._emitLogEvent({
          type: "controller.paused",
          data: {
            reason: "user_requested",
            counters: this._state.counters,
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

  async resume(): Promise<Result<ControllerStateRunning<TSchema>>> {
    switch (this._state.status) {
      case "paused": {
        const resumePoint =
          this._state.meta.syncTip ?? this._state.meta.startingPoint;

        this._state = {
          status: "running",
          generator: this._config.syncClient.sync({ point: resumePoint }),
          promise: Promise.resolve(),
          meta: this._state.meta,
          counters: this._state.counters,
        };

        this._config.tracingConfig.metrics?.status?.record(
          controllerStatuses.indexOf(this._state.status),
        );

        this._emitLogEvent({
          type: "controller.resumed",
          data: { resumePoint, counters: this._state.counters },
        });

        this._state.promise = this._runSyncLoop(this._state.meta.startOpts);

        return this._state;
      }
      default: {
        return new Error(
          `Controller is ${this._state.status}. Nothing to resume`,
        );
      }
    }
  }

  private _emitLogEvent(logEvent: Omit<LogEvent<TSchema>, "timestamp">): void {
    try {
      this._config.logger({
        ...logEvent,
        timestamp: Date.now(),
      } as LogEvent<TSchema>);
    } catch {
      // Silently ignore event handler errors to prevent disrupting controller flow
    }
  }

  private async _runSyncLoop(
    opts: Omit<ControllerStartOpts<TSchema>, "point">,
  ): Promise<void> {
    assert(this._state.status === "running");

    try {
      let done = false;

      let lastArrivalTime: number | undefined;

      for await (const event of this._state.generator) {
        const arrivalTime = Date.now();
        if (typeof lastArrivalTime === "number") {
          this._config.tracingConfig.metrics?.arrivalTime?.record(
            arrivalTime - lastArrivalTime,
          );
        }
        lastArrivalTime = arrivalTime;

        this._emitLogEvent({
          type: "event.received",
          data: { event: event.type },
        });

        try {
          if (opts.filter && !(await opts.filter(event))) {
            this._state.counters.filterCount += 1;
            this._config.tracingConfig.metrics?.filterCount?.record(
              this._state.counters.filterCount,
            );
            this._emitLogEvent({
              type: "event.filtered",
              data: { event: event.type },
            });
            continue;
          }

          this._emitLogEvent({
            type: "event.processing",
            data: { event: event.type },
          });

          const processingStart = Date.now();

          const res = await opts.fn(event);

          const processingTime = Date.now() - processingStart;

          this._config.tracingConfig.metrics?.processingTime?.record(
            processingTime,
          );

          this._emitLogEvent({
            type: "event.processed",
            data: {
              event: event.type,
              result: res ?? undefined,
              processingTime,
            },
          });

          this._state.meta.chainTip = event.tip;
          if (typeof event.tip === "object") {
            this._config.tracingConfig.metrics?.chainTipSlot?.record(
              event.tip.slot,
            );
            this._config.tracingConfig.metrics?.chainTipHeight?.record(
              event.tip.height,
            );
          }
          if (event.type === "apply" && event.block.type !== "ebb") {
            this._state.meta.syncTip = {
              slot: event.block.slot,
              id: event.block.id,
              height: event.block.height,
            };
            this._config.tracingConfig.metrics?.syncTipSlot?.record(
              event.block.slot,
            );
            this._config.tracingConfig.metrics?.syncTipHeight?.record(
              event.block.height,
            );
          }

          if (
            event.type === "apply" &&
            event.block.type !== "ebb" &&
            typeof event.tip !== "string" &&
            event.block.height === event.tip.height
          ) {
            this._config.tracingConfig.metrics?.isSynced?.record(1);
          } else {
            this._config.tracingConfig.metrics?.isSynced?.record(0);
          }

          const processedCount =
            this._state.counters.applyCount + this._state.counters.resetCount;
          if (processedCount === 0 && !this._state.meta.startingPoint) {
            this._state.meta.startingPoint = this._state.meta.syncTip;
          }

          const eventCounter = `${event.type}Count` as const;
          this._state.counters[eventCounter] += 1;
          this._config.tracingConfig.metrics?.[eventCounter]?.record(
            this._state.counters[eventCounter],
          );

          this._config.errorHandler.reset();
          this._config.tracingConfig.metrics?.errorCount?.record(0);

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

            this._emitLogEvent({
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
        stoppedAt,
        meta: this._state.meta,
        counters: this._state.counters,
      };
      this._config.tracingConfig.metrics?.status?.record(
        controllerStatuses.indexOf(this._state.status),
      );

      if (status === "done") {
        this._emitLogEvent({
          type: "controller.completed",
          data: { status: "done", counters: this._state.counters },
        });
      }
    } catch (error) {
      const parsedError = parseError(error);
      this._state.counters.errorCount += 1;
      this._config.tracingConfig.metrics?.errorCount?.record(
        this._state.counters.errorCount,
      );
      this._state.meta.lastError = parsedError;

      this._emitLogEvent({
        type: "error.caught",
        data: { error: parsedError, context: "sync_loop" },
      });

      if (this._state.status === "running") {
        const handlerResult = await this._config.errorHandler.handle(error);

        this._emitLogEvent({
          type: "error.handled",
          data: { error: parsedError, handlerResult },
        });

        if (handlerResult?.retry) {
          if (handlerResult.retry.delay) {
            this._emitLogEvent({
              type: "retry.scheduled",
              data: {
                delay: handlerResult.retry.delay,
                attempt: this._state.counters.errorCount,
                originalError: parsedError,
              },
            });
            await new Promise((resolve) => {
              setTimeout(resolve, handlerResult.retry?.delay);
            });
          }

          const resumePoint =
            this._state.meta.syncTip ?? this._state.meta.startingPoint;

          this._emitLogEvent({
            type: "retry.started",
            data: {
              attempt: this._state.counters.errorCount,
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
        stoppedAt: Date.now(),
        meta: this._state.meta,
        counters: this._state.counters,
      };
      this._config.tracingConfig.metrics?.status?.record(
        controllerStatuses.indexOf(this._state.status),
      );

      this._emitLogEvent({
        type: "controller.completed",
        data: {
          status: "crashed",
          counters: this._state.counters,
          lastError: this._state.meta.lastError,
        },
      });
    }
  }
}

export type LogEvent<TSchema extends Schema = Schema> =
  | {
      type: "controller.started";
      timestamp: number;
      data: {
        point?: TSchema["pointOrOrigin"];
        startOpts: Omit<ControllerStartOpts<TSchema>, "point">;
      };
    }
  | {
      type: "controller.paused";
      timestamp: number;
      data: {
        reason: "user_requested" | "error_limit";
        counters: ControllerStateCounters;
      };
    }
  | {
      type: "controller.resumed";
      timestamp: number;
      data: {
        resumePoint?: TSchema["pointOrOrigin"];
        counters: ControllerStateCounters;
      };
    }
  | {
      type: "controller.completed";
      timestamp: number;
      data: {
        status: "done" | "crashed";
        counters: ControllerStateCounters;
        lastError?: Error;
      };
    }
  | {
      type: "event.received" | "event.filtered" | "event.processing";
      timestamp: number;
      data: {
        event: SyncEvent<TSchema>["type"];
      };
    }
  | {
      type: "event.processed";
      timestamp: number;
      data: {
        event: SyncEvent<TSchema>["type"];
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
        event?: SyncEvent<TSchema>["type"];
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
        resumePoint?: TSchema["pointOrOrigin"];
        originalError: Error;
      };
    };

export type ControllerConfig<TSchema extends Schema = Schema> = {
  syncClient: SyncClient<TSchema>;
  errorHandler?: ErrorHandler;
  logger?: (logEvent: LogEvent<TSchema>) => void;
  tracingConfig?: TracingConfig;
};

export type ControllerStartOpts<TSchema extends Schema = Schema> = {
  fn: (
    event: SyncEvent<TSchema>,
    // biome-ignore lint/suspicious/noConfusingVoidType: Allow void for better DX
  ) => MaybePromise<{ done: boolean } | undefined | void>;
  point?: Schema["pointOrOrigin"];
  throttle?: [number, Unit];
  filter?: (event: SyncEvent<TSchema>) => MaybePromise<boolean>;
  takeUntil?: (data: {
    lastEvent: SyncEvent<TSchema>;
    state: ControllerStateRunning<TSchema>;
  }) => MaybePromise<boolean>;
};

export type ControllerStateCounters = {
  applyCount: number;
  resetCount: number;
  filterCount: number;
  errorCount: number;
};

export type ControllerStateMeta<TSchema extends Schema = Schema> = {
  startOpts: Omit<ControllerStartOpts<TSchema>, "point">;
  startingPoint: TSchema["pointOrOrigin"] | undefined;
  syncTip: TSchema["point"] | TSchema["tipOrOrigin"] | undefined;
  chainTip: TSchema["tipOrOrigin"] | undefined;
  lastError: Error | undefined;
};

export type ControllerStateBase<TSchema extends Schema = Schema> = {
  counters: ControllerStateCounters;
  meta: ControllerStateMeta<TSchema>;
};

export const controllerStatuses = [
  "idle",
  "running",
  "paused",
  "done",
  "crashed",
] as const;
export type ControllerStatus = (typeof controllerStatuses)[number];

export type ControllerStateIdle = { status: "idle" };

export type ControllerStateRunning<TSchema extends Schema = Schema> = {
  status: "running";
  generator: AsyncGenerator<SyncEvent<TSchema>, void>;
  promise: Promise<void>;
} & ControllerStateBase<TSchema>;

export type ControllerStateStopped<TSchema extends Schema = Schema> = {
  status: "paused" | "done" | "crashed";
  stoppedAt: number;
} & ControllerStateBase<TSchema>;

export type ControllerState<TSchema extends Schema = Schema> =
  | ControllerStateIdle
  | ControllerStateRunning<TSchema>
  | ControllerStateStopped<TSchema>;
