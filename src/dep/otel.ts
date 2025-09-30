import {
  type Meter,
  type MeterOptions,
  type MetricOptions,
  metrics,
  ValueType,
} from "@opentelemetry/api";
import { entries } from "../lib/entries";
import { metricDefs, type Tracing } from "../tracing";

export type CreateOtelTracingInput =
  | { name: string; version?: string; opts?: MeterOptions }
  | Meter;

export function otelTracing(input?: CreateOtelTracingInput): Tracing {
  let meter: Meter;
  if (!input) {
    meter = metrics.getMeter("anvil-barrow");
  } else if ("createGauge" in input) {
    meter = input;
  } else {
    meter = metrics.getMeter(input.name, input.version, input.opts);
  }

  return {
    metrics: entries(metricDefs).reduce<NonNullable<Tracing["metrics"]>>(
      (acc, [name, metric]) => {
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
      },
      {},
    ),
  };
}
