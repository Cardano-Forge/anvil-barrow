import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { type Level, pino } from "pino";
import { assert, unwrap } from "trynot";
import { Controller } from "../controller";
import { type MempoolRunnerDef, OgmiosMempool } from "../dep/ogmios";
import { OtelTracer } from "../dep/otel";
import { pinoLogger } from "../dep/pino";
import { ErrorHandler } from "../error-handler";
import { ProcessingError, SocketClosedError, SocketError } from "../errors";

// Setup ogmios sync client
const runner = new OgmiosMempool({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

// Setup otel tracing
new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
}).start();
const tracing = new OtelTracer();

// Setup pino logger
const level: Level = "trace";
const logger = pinoLogger<MempoolRunnerDef>(
  pino({
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
  }),
);

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

const controller = new Controller<MempoolRunnerDef>({
  runner,
  errorHandler,
  logger,
  tracing,
});

async function main() {
  // Start sync jo
  const result = await unwrap(
    controller.start({
      // Throttle event arrival rate
      throttle: [100, "milliseconds"],

      // Only process a specific event
      filter: (event) => {
        return event.type === "txs" && event.txs.length > 0;
      },

      // Complete sync job when event is processed
      takeUntil: ({ state }) => {
        return state.counters.txsCount >= 1;
      },

      fn: (_event) => {
        // Process the event
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
