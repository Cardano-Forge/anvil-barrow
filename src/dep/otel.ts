import {
  type Meter,
  type MeterOptions,
  type MetricOptions,
  metrics as otelMetrics,
  ValueType,
} from "@opentelemetry/api";
import { entries } from "../lib/entries";
import { type Metrics, metricDefs, type TracingConfig } from "../tracing";

export type CreateOtelTracingInput<TMetrics extends Metrics = Metrics> = {
  meter?: { name: string; version?: string; opts?: MeterOptions } | Meter;
  metrics?: TMetrics;
};

export function otelTracingConfig<TMetrics extends Metrics = Metrics>(
  input?: CreateOtelTracingInput<TMetrics>,
): TracingConfig {
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
    metrics: entries(input?.metrics ?? metricDefs).reduce<
      NonNullable<TracingConfig["metrics"]>
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
