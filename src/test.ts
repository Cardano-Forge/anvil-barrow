import type { Schema } from "@cardano-ogmios/client";
import { unwrap } from "trynot";
import { Controller } from "./controller";
import { OgmiosSyncClient } from "./ogmios";
import type { SyncEvent } from "./types";

const syncClient = new OgmiosSyncClient({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

const controller = new Controller({
  syncClient,
});

const point: Schema.PointOrOrigin = {
  id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
  slot: 101163751,
};

(async () => {
  const initState = await unwrap(
    controller.start({ fn: processEvent, point, take: 10, throttle: 500 }),
  );
  console.log("init", initState);
  await controller.waitForCompletion();
  console.log("finalState", controller.state);
})()
  .catch(console.error)
  .finally(() => process.exit(0));

function processEvent(event: SyncEvent) {
  console.log(
    event.type,
    event.type === "apply"
      ? event.block.height
      : typeof event.point === "string"
        ? event.point
        : event.point.slot,
  );
  if (event.type === "apply") {
    throw new Error("THATS ENOUGH");
  }
}
