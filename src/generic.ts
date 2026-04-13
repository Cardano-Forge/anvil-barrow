import { assert, unwrap } from "trynot";
import { Controller } from "./controller";
import { OgmiosSyncClient } from "./dep/ogmios";
import { ErrorHandler } from "./error-handler";
import { ProcessingError, SocketClosedError, SocketError } from "./errors";

// Setup ogmios sync client
const syncClient = new OgmiosSyncClient({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
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

const controller = new Controller({
  syncClient,
  errorHandler,
  logger,
  tracingConfig,
});

async function main() {
  // Start sync job
  const result = await unwrap(
    controller.start({
      // Throttle event arrival rate
      throttle: [100, "milliseconds"],

      // Only process a specific event
      filter: (event) => {
        return event.type === "apply" && event.block.height === 3859660;
      },

      // Complete sync job when event is processed
      takeUntil: ({ state }) => {
        return state.counters.applyCount >= 1;
      },

      fn: (_syncEvent) => {
        // Process the sync event
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
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
