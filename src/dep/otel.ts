import {
  type Meter,
  type MeterOptions,
  type MetricOptions,
  metrics as otelMetrics,
  ValueType,
} from "@opentelemetry/api";
import { ControllerTracer } from "../controller";
import {
  IndexerControllerTracer,
  type IndexerEvent,
  type IndexerMetrics,
  type IndexerSchema,
  indexerMetricDefs,
} from "../indexer";
import { entries } from "../lib/entries";
import { type Metrics, metricDefs, type TracingConfig } from "../tracing";
import type { AnyEvent } from "../types";

export type OtelTracerInput<TMetrics extends Metrics = Metrics> = {
  meter?: { name: string; version?: string; opts?: MeterOptions } | Meter;
  metrics?: TMetrics;
};

function buildOtelConfig<TMetrics extends Metrics = Metrics>(
  input?: OtelTracerInput<TMetrics>,
  defaultMetrics: Metrics = metricDefs,
): TracingConfig<TMetrics> {
  const metrics = input?.metrics ?? defaultMetrics;
  let meter: Meter;
  if (!input?.meter) {
    meter = otelMetrics.getMeter("anvil-barrow");
  } else if ("createGauge" in input.meter) {
    meter = input.meter;
  } else {
    meter = otelMetrics.getMeter(
      input.meter.name,
      input.meter.version,
      input.meter.opts,
    );
  }

  return {
    metrics: entries(metrics).reduce<
      NonNullable<TracingConfig<TMetrics>["metrics"]>
    >((acc, [name, metric]) => {
      const opts: MetricOptions = {
        description: metric.description,
      };
      if ("unit" in metric) {
        opts.unit = metric.unit;
      }
      if ("valueType" in metric) {
        if (metric.valueType === "int") {
          opts.valueType = ValueType.INT;
        } else if (metric.valueType === "double") {
          opts.valueType = ValueType.DOUBLE;
        }
      }

      if (metric.type === "gauge") {
        acc[name] = meter.createGauge(name, opts);
      } else if (metric.type === "histogram") {
        acc[name] = meter.createHistogram(name, opts);
      }

      return acc;
    }, {}),
  };
}

export class OtelTracer<
  TMetrics extends Metrics = Metrics,
  TEvent extends AnyEvent = AnyEvent,
> extends ControllerTracer<TracingConfig<TMetrics>, TEvent> {
  constructor(input?: OtelTracerInput<TMetrics>) {
    super(buildOtelConfig(input));
  }
}

export class OtelIndexerTracer<
  TSchema extends IndexerSchema = IndexerSchema,
  TEvent extends IndexerEvent<TSchema> = IndexerEvent<TSchema>,
> extends IndexerControllerTracer<TSchema, TEvent> {
  constructor(
    input?: Omit<OtelTracerInput<IndexerMetrics>, "metrics"> & {
      metrics?: IndexerMetrics;
    },
  ) {
    super(buildOtelConfig(input, indexerMetricDefs));
  }
}
