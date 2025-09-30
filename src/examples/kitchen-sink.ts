import { pino } from "pino";
import { assert, unwrap } from "trynot";
import { Controller } from "../controller";
import { type OgmiosSchema, OgmiosSyncClient } from "../dep/ogmios";
import { otelTracing } from "../dep/otel";
import { pinoEventLogger } from "../dep/pino";
import { ErrorHandler } from "../error-handler";
import { ProcessingError, SocketClosedError, SocketError } from "../errors";
import { noop } from "../lib/noop";

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
      ErrorHandler.retry({ maxRetries: 2, baseDelay: 5000, exponential: true }),
    )
    .register(
      SocketClosedError,
      ErrorHandler.retry({ maxRetries: 2, baseDelay: 5000, exponential: true }),
    ),
  eventHandler: pinoEventLogger(pino({ level: "trace" })),
  tracingConfig: otelTracing(),
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
      // filter: (event) => event.type === "apply" && event.block.height === 3859660,
      takeUntil: ({ state }) => state.counters.applyCount >= 10,
    }),
  );
  await controller.waitForCompletion();
  assert(controller.state.status === "done");
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
