import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { type Level, pino } from "pino";
import { assert, unwrap } from "trynot";
import { Controller } from "../controller";
import { OgmiosIndexer, type OgmiosSchema } from "../dep/ogmios";
import { OtelIndexerTracer } from "../dep/otel";
import { PinoLogger } from "../dep/pino";
import { ErrorHandler } from "../error-handler";
import { ProcessingError, SocketClosedError, SocketError } from "../errors";
import type { IndexerRunnerDef } from "../indexer";

// Setup otel tracing
new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
}).start();
const tracing = new OtelIndexerTracer();

// Setup pino logger
const level: Level = "trace";
const logger = pino({
  level,
  transport: {
    targets: [
      {
        level,
        target: "pino-pretty",
        options: { colorize: true },
      },
      {
        level,
        target: "pino-opentelemetry-transport",
      },
    ],
  },
});

// Setup error handling
const errorHandler = new ErrorHandler()
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
  );

// Setup ogmios sync client
const runner = new OgmiosIndexer({
  connection: {
    host: process.env.OGMIOS_NODE_HOST,
    port: Number(process.env.OGMIOS_NODE_PORT),
    tls: Boolean(process.env.OGMIOS_NODE_TLS),
  },
  beforeRun: () => logger.info("Starting runner..."),
});

const controller = new Controller<IndexerRunnerDef<OgmiosSchema>>({
  runner,
  errorHandler,
  logger: new PinoLogger(logger),
  tracing,
});

async function main() {
  // Start sync job
  const result = await unwrap(
    controller.start({
      // Throttle event arrival rate
      throttle: [100, "milliseconds"],

      // Only process a specific event
      filter: (event) => {
        return event.type === "apply";
      },

      // Complete sync job when event is processed
      takeUntil: ({ state }) => {
        return state.counters.applyCount >= 5;
      },

      fn: (syncEvent) => {
        console.log(
          "syncEvent",
          syncEvent.type,
          syncEvent.type === "apply" ? syncEvent.block.height : syncEvent.point,
        );
      },

      // Define the starting point
      point: {
        id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
        slot: 101163751,
      },
    }),
  );

  assert(result.status === "running");

  // Wait for sync job to complete
  await controller.waitForCompletion();

  assert(controller.state.status === "done");

  console.log("final state", controller.state);
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
