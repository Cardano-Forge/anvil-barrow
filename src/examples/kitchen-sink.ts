import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { pino } from "pino";
import { assert, unwrap } from "trynot";
import { Controller } from "../controller";
import { type OgmiosSchema, OgmiosSyncClient } from "../dep/ogmios";
import { otelTracingConfig } from "../dep/otel";
import { pinoLogger } from "../dep/pino";
import { ErrorHandler } from "../error-handler";
import { ProcessingError, SocketClosedError, SocketError } from "../errors";
import { noop } from "../lib/noop";

new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
}).start();

const logger = pino({
  level: "trace",
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: { colorize: true },
        level: "trace",
      },
      {
        target: "pino-opentelemetry-transport",
        level: "trace",
      },
    ],
  },
});

const controller = new Controller({
  syncClient: new OgmiosSyncClient({
    host: process.env.OGMIOS_NODE_HOST,
    port: Number(process.env.OGMIOS_NODE_PORT),
    tls: Boolean(process.env.OGMIOS_NODE_TLS),
  }),
  errorHandler: new ErrorHandler()
    .register(
      ProcessingError,
      ErrorHandler.retry({ maxRetries: 1, baseDelay: 5000, persistent: true }),
    )
    .register(
      SocketError,
      ErrorHandler.retry({ maxRetries: 2, baseDelay: 5000, backoff: true }),
    )
    .register(
      SocketClosedError,
      ErrorHandler.retry({ maxRetries: 2, baseDelay: 5000, backoff: true }),
    ),
  logger: pinoLogger(logger),
  tracingConfig: otelTracingConfig(),
});

const point: OgmiosSchema["pointOrOrigin"] = {
  id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
  slot: 101163751,
};

async function main() {
  await unwrap(
    controller.start({
      fn: noop,
      point,
      throttle: [100, "milliseconds"],
      // Uncomment to run a specific block
      // filter: (event) => event.type === "apply" && event.block.height === 3859660,
      // Uncomment to stop after n block(s) are applied
      // takeUntil: ({ state }) => state.counters.applyCount >= 10,
    }),
  );
  await controller.waitForCompletion();
  assert(controller.state.status === "done");
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
