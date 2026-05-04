import { assert, parseError, type Result, wrap } from "trynot";
import { ErrorHandler, type HandlerResult } from "./error-handler";
import { ProcessingError } from "./errors";
import { noop } from "./lib/noop";
import { toMilliseconds, type Unit } from "./time";
import type { TracingConfig } from "./tracing";
import type {
  AnyEvent,
  Counters,
  MaybePromise,
  Runner,
  RunnerDef,
} from "./types";

export class Controller<TRunner extends RunnerDef> {
  protected _state: ControllerState<TRunner> = {
    status: "idle",
  };

  protected _config: Required<ControllerConfig<TRunner>>;
  protected _startOpts: ControllerStartOpts<TRunner>;

  constructor(
    config: ControllerConfig<TRunner>,
    startOpts: ControllerStartOpts<TRunner> = {},
  ) {
    this._config = {
      runner: config.runner,
      errorHandler: config.errorHandler ?? new ErrorHandler(),
      logger: config.logger ?? noop,
      tracing: config.tracing ?? new ControllerTracer(),
    };

    this._startOpts = startOpts;
    this._config.tracing.recordStatus(this._state.status);
  }

  get state(): ControllerState<TRunner> {
    return this._state;
  }

  async start(
    opts: ControllerStartOpts<TRunner>,
  ): Promise<Result<ControllerStateRunning<TRunner>>> {
    switch (this._state.status) {
      case "running": {
        return new Error("Controller is already running");
      }
    }

    const startOpts = { ...this._startOpts, ...opts };

    this._state = {
      status: "running",
      generator: this._config.runner.run(startOpts),
      promise: Promise.resolve(),
      meta: {
        lastError: undefined,
        ...this._config.runner.createMeta(startOpts),
      },
      counters: {
        filterCount: 0,
        errorCount: 0,
        ...this._config.runner.createCounters(startOpts),
      },
    };

    this._config.tracing.recordStatus(this._state.status);
    this._config.tracing.recordStarted();

    this._emitLogEvent({
      type: "controller.started",
      data: { meta: this._state.meta },
    });

    this._state.promise = this._runLoop(startOpts);

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

  async pause(): Promise<Result<ControllerStateStopped<TRunner>>> {
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
            meta: this._state.meta,
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

  async resume(): Promise<Result<ControllerStateRunning<TRunner>>> {
    switch (this._state.status) {
      case "paused": {
        this._state = {
          status: "running",
          generator: this._config.runner.resume(this._state.meta),
          promise: Promise.resolve(),
          meta: this._state.meta,
          counters: this._state.counters,
        };

        this._config.tracing.recordStatus(this._state.status);

        this._emitLogEvent({
          type: "controller.resumed",
          data: {
            counters: this._state.counters,
            meta: this._state.meta,
          },
        });

        this._state.promise = this._runLoop(this._state.meta.startOpts);

        return this._state;
      }
      default: {
        return new Error(
          `Controller is ${this._state.status}. Nothing to resume`,
        );
      }
    }
  }

  private _emitLogEvent(logEvent: Omit<LogEvent<TRunner>, "timestamp">): void {
    try {
      this._config.logger({
        ...logEvent,
        timestamp: Date.now(),
      } as LogEvent<TRunner>);
    } catch {
      // Silently ignore event handler errors to prevent disrupting controller flow
    }
  }

  private async _runLoop(opts: ControllerStartOpts<TRunner>): Promise<void> {
    assert(this._state.status === "running");

    try {
      let done = false;

      const applyThrottle = async () => {
        if (opts.throttle) {
          const [value, unit] = opts.throttle;
          const delay = toMilliseconds(value, unit);

          this._emitLogEvent({
            type: "throttle.delay",
            data: { delay, unit },
          });

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      };

      let lastArrivalTime: number | undefined;

      for await (const event of this._state.generator) {
        const arrivalTime = Date.now();
        if (typeof lastArrivalTime === "number") {
          this._config.tracing.recordArrivalTime(arrivalTime - lastArrivalTime);
        }
        lastArrivalTime = arrivalTime;

        this._emitLogEvent({
          type: "event.received",
          data: { event: event.type },
        });

        try {
          let processingResult: { done: boolean } | undefined;
          let isFilteredOut = false;

          if (opts.filter && !(await opts.filter(event))) {
            isFilteredOut = true;
            this._state.counters.filterCount += 1;
            this._config.tracing.recordEventFiltered(
              event,
              this._state.counters.filterCount,
            );
            this._emitLogEvent({
              type: "event.filtered",
              data: { event: event.type },
            });
          } else {
            this._emitLogEvent({
              type: "event.processing",
              data: { event: event.type },
            });

            const processingStart = Date.now();

            processingResult = (await opts.fn?.(event)) ?? undefined;

            const processingTime = Date.now() - processingStart;

            this._config.runner.onEventProcessed?.(event, this._state);
            this._config.tracing.recordEventProcessed(
              event,
              this._state.counters,
              processingTime,
            );

            this._emitLogEvent({
              type: "event.processed",
              data: {
                event: event.type,
                result: processingResult,
                processingTime,
              },
            });

            this._config.errorHandler.reset();
            this._config.tracing.recordErrorCount(0);
          }

          if (
            processingResult?.done ||
            (await opts.takeUntil?.({
              lastEvent: { ...event, isFilteredOut },
              state: this._state,
            }))
          ) {
            done = true;
            break;
          }

          await applyThrottle();
        } catch (error) {
          throw new ProcessingError(event, error);
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

      this._config.tracing.recordStatus(status);

      if (status === "done") {
        this._emitLogEvent({
          type: "controller.completed",
          data: {
            status: "done",
            counters: this._state.counters,
            meta: this._state.meta,
          },
        });
      }
    } catch (error) {
      const parsedError = parseError(error);
      this._state.counters.errorCount += 1;
      this._config.tracing.recordErrorCount(this._state.counters.errorCount);
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

          this._emitLogEvent({
            type: "retry.started",
            data: {
              attempt: this._state.counters.errorCount,
              originalError: parsedError,
            },
          });

          this._state.generator = this._config.runner.resume(this._state.meta);

          return this._runLoop(opts);
        }
      }

      this._state = {
        status: "crashed",
        stoppedAt: Date.now(),
        meta: this._state.meta,
        counters: this._state.counters,
      };

      this._config.tracing.recordStatus(this._state.status);

      this._emitLogEvent({
        type: "controller.completed",
        data: {
          status: "crashed",
          counters: this._state.counters,
          meta: this._state.meta,
        },
      });
    }
  }
}

export type LogEvent<TRunner extends RunnerDef> =
  | {
      type: "controller.started";
      timestamp: number;
      data: {
        meta: ControllerStateMeta<TRunner>;
      };
    }
  | {
      type: "controller.paused";
      timestamp: number;
      data: {
        reason: "user_requested" | "error_limit";
        counters: ControllerStateCounters<TRunner>;
        meta: ControllerStateMeta<TRunner>;
      };
    }
  | {
      type: "controller.resumed";
      timestamp: number;
      data: {
        counters: ControllerStateCounters<TRunner>;
        meta: ControllerStateMeta<TRunner>;
      };
    }
  | {
      type: "controller.completed";
      timestamp: number;
      data: {
        status: "done" | "crashed";
        counters: ControllerStateCounters<TRunner>;
        meta: ControllerStateMeta<TRunner>;
      };
    }
  | {
      type: "event.received" | "event.filtered" | "event.processing";
      timestamp: number;
      data: {
        event: TRunner["event"]["type"];
      };
    }
  | {
      type: "event.processed";
      timestamp: number;
      data: {
        event: TRunner["event"]["type"];
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
        event?: TRunner["event"]["type"];
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
        originalError: Error;
      };
    };

export type ControllerConfig<TRunner extends RunnerDef> = {
  runner: Runner<TRunner>;
  errorHandler?: ErrorHandler;
  logger?: (logEvent: LogEvent<TRunner>) => void;
  tracing?: ControllerTracer;
};

export type ControllerStartOpts<TRunner extends RunnerDef> = TRunner["opts"] & {
  /** Function that handles sync events */
  fn?: (
    event: TRunner["event"],
  ) => MaybePromise<{ done: boolean } | undefined | void>;
  /** Throttle duration for sync events */
  throttle?: [number, Unit];
  /** Function to filter sync events */
  filter?: (event: TRunner["event"]) => MaybePromise<boolean>;
  /** Function that returns true to stop syncing */
  takeUntil?: (data: {
    lastEvent: TRunner["event"] & {
      /**
       * Whether the event was filtered out by the filter function
       */
      isFilteredOut: boolean;
    };
    state: ControllerStateRunning<TRunner>;
  }) => MaybePromise<boolean>;
};

export type ControllerStateCounters<TRunner extends RunnerDef> = Counters<
  TRunner["event"]
> & {
  filterCount: number;
  errorCount: number;
};

export type ControllerStateMeta<TRunner extends RunnerDef> = TRunner["meta"] & {
  lastError: Error | undefined;
};

export type ControllerStateBase<TRunner extends RunnerDef> = {
  counters: ControllerStateCounters<TRunner>;
  meta: ControllerStateMeta<TRunner>;
};

export const controllerStatuses = [
  "idle",
  "running",
  "paused",
  "done",
  "crashed",
] as const;
export type ControllerStatus = (typeof controllerStatuses)[number];

export type ControllerStateIdle = {
  status: "idle";
};

export type ControllerStateRunning<TRunner extends RunnerDef> = {
  status: "running";
  generator: AsyncGenerator<TRunner["event"], void>;
  promise: Promise<void>;
} & ControllerStateBase<TRunner>;

export type ControllerStateStopped<TRunner extends RunnerDef> = {
  status: "paused" | "done" | "crashed";
  stoppedAt: number;
} & ControllerStateBase<TRunner>;

export type ControllerState<TRunner extends RunnerDef> =
  | ControllerStateIdle
  | ControllerStateRunning<TRunner>
  | ControllerStateStopped<TRunner>;

export class ControllerTracer<
  TConfig extends TracingConfig = TracingConfig,
  TEvent extends AnyEvent = AnyEvent,
> {
  constructor(public readonly config?: TConfig) {}

  recordStatus(status: ControllerStatus) {
    this.config?.metrics?.status?.record(controllerStatuses.indexOf(status));
  }

  recordErrorCount(count: number) {
    this.config?.metrics?.errorCount?.record(count);
  }

  recordStarted() {
    this.config?.metrics?.filterCount?.record(0);
    this.config?.metrics?.errorCount?.record(0);
  }

  recordCrashed() {
    this.recordStatus("crashed");
  }

  recordArrivalTime(time: number) {
    this.config?.metrics?.arrivalTime?.record(time);
  }

  recordEventFiltered(_event: TEvent, filterCount: number) {
    this.config?.metrics?.filterCount?.record(filterCount);
  }

  recordEventProcessed(
    _event: TEvent,
    _counters: Counters<TEvent>,
    processingTime: number,
  ) {
    this.config?.metrics?.processingTime?.record(processingTime);
  }
}
