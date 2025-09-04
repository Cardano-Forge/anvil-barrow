import type { Schema } from "@cardano-ogmios/client";
import { parseError, unwrap } from "trynot";
import { Controller } from "./controller";
import { ErrorHandler } from "./error-handler";
import { OgmiosSyncClient } from "./ogmios";
import type { SyncEvent } from "./types";

const syncClient = new OgmiosSyncClient({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

const errorHandler = new ErrorHandler()
  .register(ErrorHandler.retry({ maxRetries: 3, persistent: true }))
  .register((error) => console.log("error", parseError(error).message));

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
    controller.start({ fn: processEvent, point, take: 10, throttle: 100 }),
  );
  console.log("init", initState);
  await controller.waitForCompletion();
  console.log("finalState", controller.state);
})()
  .catch(console.error)
  .finally(() => process.exit(0));

let processed = 0;

function processEvent(event: SyncEvent) {
  processed += 1;
  if (processed > 2) {
    processed = 0;
    throw new Error("too much processing");
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
