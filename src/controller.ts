import type { Schema } from "@cardano-ogmios/client";
import type { Counter, Gauge, Histogram } from "@opentelemetry/api";
import { assert, parseError, type Result, wrap } from "trynot";
import { ErrorHandler, type HandlerResult } from "./error-handler";
import { ProcessingError } from "./errors";
import { noop } from "./lib/noop";
import { toMilliseconds, type Unit } from "./time";
import type { MaybePromise, SyncClient, SyncEvent } from "./types";

export class Controller {
  protected _state: ControllerState = {
    status: "idle",
  };

  protected _config: Required<ControllerConfig>;

  constructor(config: ControllerConfig) {
    this._config = {
      syncClient: config.syncClient,
      errorHandler:
        config.errorHandler ??
        new ErrorHandler((error) => {
          console.error(parseError(error).message);
          return undefined;
        }),
      eventHandler: config.eventHandler ?? noop,
      otel: config.otel ?? {},
    };

    this._config.otel.metrics?.status?.record(
      controllerStatuses.indexOf(this._state.status),
    );
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

    this._config.otel.metrics?.status?.record(
      controllerStatuses.indexOf(this._state.status),
    );
    this._config.otel.metrics?.isSynced?.record(0);
    this._config.otel.metrics?.syncTipSlot?.record(0);
    this._config.otel.metrics?.syncTipHeight?.record(0);
    this._config.otel.metrics?.chainTipSlot?.record(0);
    this._config.otel.metrics?.chainTipHeight?.record(0);
    this._config.otel.metrics?.filterCount?.record(0);
    this._config.otel.metrics?.applyCount?.record(0);
    this._config.otel.metrics?.resetCount?.record(0);
    this._config.otel.metrics?.errorCount?.record(0);

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

  async resume(): Promise<Result<ControllerStateRunning>> {
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

        this._config.otel.metrics?.status?.record(
          controllerStatuses.indexOf(this._state.status),
        );

        this._emitEvent({
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

      let lastArrivalTime: number | undefined;

      for await (const event of this._state.generator) {
        const arrivalTime = Date.now();
        if (typeof lastArrivalTime === "number") {
          this._config.otel.metrics?.arrivalTime?.record(
            arrivalTime - lastArrivalTime,
          );
        }
        lastArrivalTime = arrivalTime;

        this._emitEvent({
          type: "event.received",
          data: { event: event.type },
        });

        try {
          if (opts.filter && !(await opts.filter(event))) {
            this._state.counters.filterCount += 1;
            this._config.otel.metrics?.filterCount?.record(
              this._state.counters.filterCount,
            );
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

          this._config.otel.metrics?.processingTime?.record(processingTime);

          this._emitEvent({
            type: "event.processed",
            data: {
              event: event.type,
              result: res ?? undefined,
              processingTime,
            },
          });

          this._state.meta.chainTip = event.tip;
          if (typeof event.tip === "object") {
            this._config.otel.metrics?.chainTipSlot?.record(event.tip.slot);
            this._config.otel.metrics?.chainTipHeight?.record(event.tip.height);
          }
          if (event.type === "apply" && event.block.type !== "ebb") {
            this._state.meta.syncTip = {
              slot: event.block.slot,
              id: event.block.id,
              height: event.block.height,
            };
            this._config.otel.metrics?.syncTipSlot?.record(event.block.slot);
            this._config.otel.metrics?.syncTipHeight?.record(
              event.block.height,
            );
          }

          if (
            event.type === "apply" &&
            event.block.type !== "ebb" &&
            typeof event.tip !== "string" &&
            event.block.height === event.tip.height
          ) {
            this._config.otel.metrics?.isSynced?.record(1);
          } else {
            this._config.otel.metrics?.isSynced?.record(0);
          }

          const processedCount =
            this._state.counters.applyCount + this._state.counters.resetCount;
          if (processedCount === 0 && !this._state.meta.startingPoint) {
            this._state.meta.startingPoint = this._state.meta.syncTip;
          }

          const eventCounter = `${event.type}Count` as const;
          this._state.counters[eventCounter] += 1;
          this._config.otel.metrics?.[eventCounter]?.record(
            this._state.counters[eventCounter],
          );

          this._config.errorHandler.reset();
          this._config.otel.metrics?.errorCount?.record(0);

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
        stoppedAt,
        meta: this._state.meta,
        counters: this._state.counters,
      };
      this._config.otel.metrics?.status?.record(
        controllerStatuses.indexOf(this._state.status),
      );

      if (status === "done") {
        this._emitEvent({
          type: "controller.completed",
          data: { status: "done", counters: this._state.counters },
        });
      }
    } catch (error) {
      const parsedError = parseError(error);
      this._state.counters.errorCount += 1;
      this._config.otel.metrics?.errorCount?.record(
        this._state.counters.errorCount,
      );
      this._state.meta.lastError = parsedError;

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

          this._emitEvent({
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
      this._config.otel.metrics?.status?.record(
        controllerStatuses.indexOf(this._state.status),
      );

      this._emitEvent({
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
        counters: ControllerStateCounters;
      };
    }
  | {
      type: "controller.resumed";
      timestamp: number;
      data: {
        resumePoint?: Schema.PointOrOrigin;
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
  otel?: Otel;
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

export type ControllerStateCounters = {
  applyCount: number;
  resetCount: number;
  filterCount: number;
  errorCount: number;
};

export type ControllerStateMeta = {
  startOpts: Omit<ControllerStartOpts, "point">;
  startingPoint: Schema.PointOrOrigin | undefined;
  syncTip: Schema.Point | Schema.TipOrOrigin | undefined;
  chainTip: Schema.TipOrOrigin | undefined;
  lastError: Error | undefined;
};

export type ControllerStateBase = {
  counters: ControllerStateCounters;
  meta: ControllerStateMeta;
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

export type MetricTypes = {
  gauge: Gauge;
  counter: Counter;
  histogram: Histogram;
};

export type Metric = {
  type: keyof MetricTypes;
  name: string;
  description: string;
  unit?: string;
};

const metrics = {
  // metadata
  status: {
    type: "gauge",
    name: "status",
    description: `Controller status (${controllerStatuses.map((s, i) => `${s} = ${i}`).join(", ")})`,
  },
  syncTipSlot: {
    type: "gauge",
    name: "sync_tip_slot",
    description: "Sync tip slot",
  },
  syncTipHeight: {
    type: "gauge",
    name: "sync_tip_height",
    description: "Sync tip height",
  },
  chainTipSlot: {
    type: "gauge",
    name: "chain_tip_slot",
    description: "Chain tip slot",
  },
  chainTipHeight: {
    type: "gauge",
    name: "chain_tip_height",
    description: "Chain tip height",
  },
  isSynced: {
    type: "gauge",
    name: "is_synced",
    description: "Is synced (1 = yes, 0 = no)",
  },
  // Histograms
  processingTime: {
    type: "histogram",
    name: "processing_time",
    description: "Time it takes to process an event",
    unit: "milliseconds",
  },
  arrivalTime: {
    type: "histogram",
    name: "arrival_time",
    description: "Time it takes to receive an event",
    unit: "milliseconds",
  },
  // Counters
  applyCount: {
    type: "gauge",
    name: "apply_count",
    description: "Number of apply events",
  },
  resetCount: {
    type: "gauge",
    name: "reset_count",
    description: "Number of reset events",
  },
  filterCount: {
    type: "gauge",
    name: "filter_count",
    description: "Number of filtered events",
  },
  errorCount: {
    type: "gauge",
    name: "error_count",
    description: "Number of errors",
  },
} satisfies Record<string, Metric>;
export type Metrics = typeof metrics;

export type Otel = {
  metrics?: {
    [K in keyof Metrics]?: MetricTypes[Metrics[K]["type"]];
  };
};
