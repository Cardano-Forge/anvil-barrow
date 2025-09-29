import { controllerStatuses } from "./controller";

export type MetricTypes = {
  gauge: { record: (value: number) => void };
  histogram: { record: (value: number) => void };
};

export type Metric = {
  type: keyof MetricTypes;
  name: string;
  description: string;
  unit?: string;
  valueType?: "int" | "double";
};

export const metricDefs = {
  // metadata
  status: {
    type: "gauge",
    name: "status",
    description: `Controller status (${controllerStatuses.map((s, i) => `${s} = ${i}`).join(", ")})`,
    valueType: "int",
  },
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
    valueType: "int",
  },
  resetCount: {
    type: "gauge",
    name: "reset_count",
    description: "Number of reset events",
    valueType: "int",
  },
  filterCount: {
    type: "gauge",
    name: "filter_count",
    description: "Number of filtered events",
    valueType: "int",
  },
  errorCount: {
    type: "gauge",
    name: "error_count",
    description: "Number of errors",
    valueType: "int",
  },
} satisfies Record<string, Metric>;
export type Metrics = typeof metricDefs;

export type Otel = {
  metrics?: {
    [K in keyof Metrics]?: MetricTypes[Metrics[K]["type"]];
  };
};
