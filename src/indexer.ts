import { ControllerTracer } from "./controller";
import type { Metric, Metrics, TracingConfig } from "./tracing";
import {
  type Counters,
  getEventCounterKey,
  type Runner,
  type RunnerDef,
} from "./types";

export const indexerMetricDefs = {
  syncTipSlot: {
    type: "gauge",
    name: "sync_tip_slot",
    description: "Sync tip slot",
    valueType: "int",
  },
  syncTipHeight: {
    type: "gauge",
    name: "sync_tip_height",
    description: "Sync tip height",
    valueType: "int",
  },
  chainTipSlot: {
    type: "gauge",
    name: "chain_tip_slot",
    description: "Chain tip slot",
    valueType: "int",
  },
  chainTipHeight: {
    type: "gauge",
    name: "chain_tip_height",
    description: "Chain tip height",
    valueType: "int",
  },
  isSynced: {
    type: "gauge",
    name: "is_synced",
    description: "Is synced (1 = yes, 0 = no)",
    valueType: "int",
  },
  applyCount: {
    type: "gauge",
    name: "apply_count",
    description: "Number of apply events",
    valueType: "int",
  },
  resetCount: {
    type: "gauge",
    name: "reset_count",
    description: "Number of reset events",
    valueType: "int",
  },
} satisfies Record<string, Metric>;
export type IndexerMetrics = typeof indexerMetricDefs;

export type Point =
  | {
      slot: number;
      id: string;
    }
  | string;

export type Tip =
  | {
      slot: number;
      id: string;
      height: number;
    }
  | string;

export type Block =
  | {
      type: "ebb";
      era: "byron";
      id: string;
      height: number;
      slot?: undefined;
    }
  | {
      type: "bft";
      era: "byron";
      id: string;
      height: number;
      slot: number;
    }
  | {
      type: "praos";
      era: "shelley" | "allegra" | "mary" | "alonzo" | "babbage" | "conway";
      id: string;
      height: number;
      slot: number;
    };

export type Schema<
  TBlock extends Block = Block,
  TResetPoint extends Point = Point,
  TStartingPoint extends Point = Point,
  TTip extends Tip = Tip,
> = {
  block: TBlock;
  resetPoint: TResetPoint;
  startingPoint: TStartingPoint;
  tip: TTip;
};

export type IndexerEvent<TSchema extends Schema = Schema> =
  | {
      type: "apply";
      block: TSchema["block"];
      tip: TSchema["tip"];
    }
  | {
      type: "reset";
      point: TSchema["resetPoint"];
      tip: TSchema["tip"];
    };

export type IndexerTracingConfig = TracingConfig<Metrics & IndexerMetrics>;

export class IndexerControllerTracer<
  TConfig extends IndexerTracingConfig = TracingConfig,
  TSchema extends Schema = Schema,
  TEvent extends IndexerEvent<TSchema> = IndexerEvent<TSchema>,
> extends ControllerTracer<TConfig, TEvent> {
  recordStarted() {
    super.recordStarted();
    this.config?.metrics?.isSynced?.record(0);
    this.config?.metrics?.syncTipSlot?.record(0);
    this.config?.metrics?.syncTipHeight?.record(0);
    this.config?.metrics?.chainTipSlot?.record(0);
    this.config?.metrics?.chainTipHeight?.record(0);
    this.config?.metrics?.applyCount?.record(0);
    this.config?.metrics?.resetCount?.record(0);
  }

  recordEventProcessed(
    event: TEvent,
    counters: Counters<TEvent>,
    processingTime: number,
  ) {
    super.recordEventProcessed(event, counters, processingTime);
    if (typeof event.tip === "object") {
      this.config?.metrics?.chainTipSlot?.record(event.tip.slot);
      this.config?.metrics?.chainTipHeight?.record(event.tip.height);
    }
    if (event.type === "apply" && event.block.type !== "ebb") {
      this.config?.metrics?.syncTipSlot?.record(event.block.slot);
      this.config?.metrics?.syncTipHeight?.record(event.block.height);
    }
    if (
      event.type === "apply" &&
      event.block.type !== "ebb" &&
      typeof event.tip !== "string" &&
      event.block.height === event.tip.height
    ) {
      this.config?.metrics?.isSynced?.record(1);
    } else {
      this.config?.metrics?.isSynced?.record(0);
    }
    const counterKey = getEventCounterKey(event);
    const typedCounters = counters as Counters<IndexerEvent>;
    this.config?.metrics?.[counterKey]?.record(typedCounters[counterKey]);
  }
}

export type IndexerRunnerDef<TSchema extends Schema = Schema> = RunnerDef<
  {
    startingPoint: TSchema["startingPoint"];
    syncTip: TSchema["tip"] | undefined;
    chainTip: TSchema["tip"] | undefined;
  },
  { point: TSchema["startingPoint"] },
  IndexerEvent<TSchema>
>;

export abstract class IndexerRunner<TRunner extends IndexerRunnerDef>
  implements Runner<TRunner>
{
  createCounters(): Counters<TRunner["event"]> {
    return {
      applyCount: 0,
      resetCount: 0,
    } as Counters<TRunner["event"]>;
  }

  createMeta(opts: TRunner["opts"]): TRunner["meta"] {
    return {
      startingPoint: opts.point,
      syncTip: undefined,
      chainTip: undefined,
    };
  }

  resume(meta: TRunner["meta"]) {
    const resumePoint = meta.syncTip ?? meta.startingPoint;
    return this.run({ point: resumePoint });
  }

  onEventProcessed(
    event: TRunner["event"],
    mut: { meta: TRunner["meta"]; counters: Counters<TRunner["event"]> },
  ): void {
    mut.meta.chainTip = event.tip;
    if (event.type === "apply" && event.block.type !== "ebb") {
      mut.meta.syncTip = {
        slot: event.block.slot,
        id: event.block.id,
        height: event.block.height,
      };
    }
    const counters = mut.counters as Counters<IndexerEvent>;
    const counterKey = `${event.type}Count` as const;
    counters[counterKey] += 1;
  }

  abstract run(
    opts: TRunner["opts"],
    // biome-ignore lint/suspicious/noExplicitAny: Need flexible parameters
  ): AsyncGenerator<TRunner["event"], void, any>;
}
