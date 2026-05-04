import { ControllerTracer } from "./controller";
import { type Metric, metricDefs, type TracingConfig } from "./tracing";
import {
  type Counters,
  getEventCounterKey,
  type Runner,
  type RunnerDef,
} from "./types";

export const indexerMetricDefs = {
  ...metricDefs,
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

export type IndexerPoint =
  | {
      slot: number;
      id: string;
    }
  | string;

export type IndexerTip =
  | {
      slot: number;
      id: string;
      height: number;
    }
  | string;

export type IndexerBlock =
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

export type IndexerSchema<
  TBlock extends IndexerBlock = IndexerBlock,
  TResetPoint extends IndexerPoint = IndexerPoint,
  TStartingPoint extends IndexerPoint = IndexerPoint,
  TTip extends IndexerTip = IndexerTip,
> = {
  block: TBlock;
  resetPoint: TResetPoint;
  startingPoint: TStartingPoint;
  tip: TTip;
};

export type IndexerEvent<TSchema extends IndexerSchema = IndexerSchema> =
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

export type IndexerTracingConfig = TracingConfig<IndexerMetrics>;

export class IndexerControllerTracer<
  TConfig extends IndexerTracingConfig = TracingConfig,
  TSchema extends IndexerSchema = IndexerSchema,
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

export type IndexerRunnerDef<TSchema extends IndexerSchema = IndexerSchema> =
  RunnerDef<
    {
      startingPoint: TSchema["startingPoint"];
      syncTip: TSchema["tip"] | undefined;
      chainTip: TSchema["tip"] | undefined;
    },
    { point: TSchema["startingPoint"] },
    IndexerEvent<TSchema>
  >;

export abstract class IndexerRunner<TDef extends IndexerRunnerDef>
  implements Runner<TDef>
{
  createCounters(): Counters<TDef["event"]> {
    return {
      applyCount: 0,
      resetCount: 0,
    } as Counters<TDef["event"]>;
  }

  createMeta(opts: TDef["opts"]): TDef["meta"] {
    return {
      startingPoint: opts.point,
      syncTip: undefined,
      chainTip: undefined,
    };
  }

  resume(meta: TDef["meta"]) {
    const resumePoint = meta.syncTip ?? meta.startingPoint;
    return this.run({ point: resumePoint });
  }

  onEventProcessed(event: TDef["event"], mut: { meta: TDef["meta"] }): void {
    mut.meta.chainTip = event.tip;
    if (event.type === "apply" && event.block.type !== "ebb") {
      mut.meta.syncTip = {
        slot: event.block.slot,
        id: event.block.id,
        height: event.block.height,
      };
    }
  }

  abstract run(
    opts: TDef["opts"],
    // biome-ignore lint/suspicious/noExplicitAny: Need flexible parameters
  ): AsyncGenerator<TDef["event"], void, any>;
}
