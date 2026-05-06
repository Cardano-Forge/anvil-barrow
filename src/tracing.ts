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
  status: {
    type: "gauge",
    name: "status",
    description: `Controller status (${controllerStatuses.map((s, i) => `${s} = ${i}`).join(", ")})`,
    valueType: "int",
  },
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

export type TracingConfig<TMetrics extends Record<string, Metric> = Metrics> = {
  metrics?: {
    [K in keyof TMetrics]?: MetricTypes[TMetrics[K]["type"]];
  };
};
