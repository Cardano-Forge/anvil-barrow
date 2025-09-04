import type { Schema } from "@cardano-ogmios/client";
import { unwrap } from "trynot";
import { Controller } from "./controller";
import { ErrorHandler } from "./error-handler";
import { ProcessingError, SocketClosedError, SocketError } from "./errors";
import { noop } from "./lib/noop";
import { OgmiosSyncClient } from "./ogmios";

const syncClient = new OgmiosSyncClient({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

const errorHandler = new ErrorHandler()
  .register(
    ProcessingError,
    ErrorHandler.retry({ maxRetries: 1, persistent: true }),
  )
  .register(
    SocketError,
    ErrorHandler.retry({ maxRetries: 2, baseDelay: 5000, exponential: true }),
  )
  .register(
    SocketClosedError,
    ErrorHandler.retry({ maxRetries: 2, baseDelay: 5000, exponential: true }),
  );

const controller = new Controller({
  syncClient,
  errorHandler,
  eventHandler: event => console.log(event.type),
});

const point: Schema.PointOrOrigin = {
  id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
  slot: 101163751,
};

(async () => {
  await unwrap(
    controller.start({
      fn: noop,
      point,
      throttle: [0.5, "seconds"],
      // filter: (event) => event.type === "apply" && event.block.height === 3859660,
      takeUntil: ({ state }) => state.applyCount >= 10,
    }),
  );
  await controller.waitForCompletion();
  if (controller.state.status === "paused") {
    await unwrap(controller.resume());
    await controller.waitForCompletion();
  }
})()
  .catch(console.error)
  .finally(() => process.exit(0));
