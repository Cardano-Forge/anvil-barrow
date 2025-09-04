import type { Schema } from "@cardano-ogmios/client";
import type { Unit } from "./time";

export type SyncEvent =
  | { type: "apply"; block: Schema.Block; tip: Schema.TipOrOrigin }
  | { type: "reset"; point: Schema.PointOrOrigin; tip: Schema.TipOrOrigin };

export type SyncClientSyncOpts = {
  point?: Schema.PointOrOrigin;
};

export type SyncClient = {
  sync: (opts?: SyncClientSyncOpts) => AsyncGenerator<SyncEvent, void>;
};

export type MaybePromise<T> = T | Promise<T>;

export type ControllerEvent =
  | {
      type: "controller.started";
      timestamp: number;
      data: {
        point?: Schema.PointOrOrigin;
        startOpts: {
          fn: (
            event: SyncEvent,
          ) => MaybePromise<{ done: boolean } | undefined | void>;
          throttle?: [number, Unit];
          filter?: (event: SyncEvent) => MaybePromise<boolean>;
          takeUntil?: (data: {
            lastEvent: SyncEvent;
            state: any;
          }) => MaybePromise<boolean>;
        };
      };
    }
  | {
      type: "controller.paused";
      timestamp: number;
      data: {
        reason: "user_requested" | "error_limit";
        stats: {
          applyCount: number;
          resetCount: number;
          filterCount: number;
          errorCount: number;
        };
      };
    }
  | {
      type: "controller.resumed";
      timestamp: number;
      data: {
        resumePoint?: Schema.PointOrOrigin;
        stats: {
          applyCount: number;
          resetCount: number;
          filterCount: number;
          errorCount: number;
        };
      };
    }
  | {
      type: "controller.completed";
      timestamp: number;
      data: {
        status: "done" | "crashed";
        stats: {
          applyCount: number;
          resetCount: number;
          filterCount: number;
          errorCount: number;
        };
        lastError?: Error;
      };
    }
  | {
      type: "event.received";
      timestamp: number;
      data: {
        event: SyncEvent;
      };
    }
  | {
      type: "event.filtered";
      timestamp: number;
      data: {
        event: SyncEvent;
      };
    }
  | {
      type: "event.processing";
      timestamp: number;
      data: {
        event: SyncEvent;
      };
    }
  | {
      type: "event.processed";
      timestamp: number;
      data: {
        event: SyncEvent;
        result?: { done: boolean } | undefined | void;
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
        event?: SyncEvent;
        context: "processing" | "sync_loop" | "generator";
      };
    }
  | {
      type: "error.handled";
      timestamp: number;
      data: {
        error: Error;
        handlerResult?: {
          retry?: {
            delay?: number;
          };
        };
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
