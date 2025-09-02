import type { Schema } from "@cardano-ogmios/client";
import { OgmiosSyncClient } from "./ogmios";
import type { SyncEvent } from "./types";

const client = new OgmiosSyncClient({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

(async () => {
  const state = {
    tip: {
      id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
      slot: 101163751,
    } as Schema.PointOrOrigin,
    processed: 0,
    retries: 0,
  };

  let canRetry = false;
  do {
    try {
      const sync = client.sync([state.tip]);
      console.log("syncing...");
      for await (const event of sync) {
        if (event.type === "apply") {
          state.processed++;
        }
        if (state.processed > 4) {
          break;
        }
        processEvent(event);
        state.retries = 0;
        if (event.type === "reset") {
          state.tip = event.point;
        } else {
          state.tip =
            event.block.type === "ebb"
              ? "origin"
              : {
                  id: event.block.id,
                  slot: event.block.slot,
                };
        }
      }
      canRetry = false;
    } catch (error) {
      console.log("error", (error as Error).message);
      canRetry = state.retries++ < 1;
    }
  } while (canRetry);
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
}
