import type { Metric } from "./tracing";

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

export type IndexerEvent<TSchema extends Schema> =
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
