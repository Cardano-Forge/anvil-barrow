import type { Schema } from "@cardano-ogmios/client";
import { parseError, unwrap } from "trynot";
import { Controller } from "./controller";
import { ErrorHandler } from "./error-handler";
import { ProcessingError, SocketClosedError, SocketError } from "./errors";
import { OgmiosSyncClient } from "./ogmios";
import type { SyncEvent } from "./types";

const syncClient = new OgmiosSyncClient({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

const errorHandler = new ErrorHandler()
  .register((error) => console.log("error", parseError(error).message))
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
});

const point: Schema.PointOrOrigin = {
  id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
  slot: 101163751,
};

(async () => {
  const initState = await unwrap(
    controller.start({
      fn: processEvent,
      point,
      throttle: [1, "seconds"],
      // filter: (event) => event.type === "apply" && event.block.height === 3859660,
      // takeUntil: ({ state }) => state.applyCount > 0,
    }),
  );
  console.log("initState", initState);
  await controller.waitForCompletion();
  if (controller.state.status === "paused") {
    const resumeState = await unwrap(controller.resume());
    console.log("resumeState", resumeState);
    await controller.waitForCompletion();
  }
  console.log("finalState", controller.state);
})()
  .catch(console.error)
  .finally(() => process.exit(0));

let processedCount = 0;

function processEvent(event: SyncEvent) {
  processedCount += 1;
  if (processedCount === 10 || processedCount === 15) {
    // throw new Error("processing error");
  }
  console.log(
    event.type,
    event.type === "apply"
      ? event.block.height
      : typeof event.point === "string"
        ? event.point
        : event.point.slot,
  );
}
