import type { Schema } from "@cardano-ogmios/client";
import { defer } from "ix/asynciterable";
import { filter, retry, take } from "ix/asynciterable/operators";
import { OgmiosSyncClient } from "./ogmios";
import type { SyncEvent } from "./types";

const syncClient = new OgmiosSyncClient({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

const points: Schema.PointOrOrigin[] = [
  {
    id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
    slot: 101163751,
  },
];

(async () => {
  await defer(() => syncClient.sync({ points }))
    .pipe(
      retry(),
      filter((event) => event.type === "apply"),
      take(6),
    )
    .forEach(processEvent);
})()
  .catch(console.error)
  .finally(() => process.exit(0));

export function getTip(event: SyncEvent) {
  if (event.type === "reset") {
    return event.point;
  }
  if (event.block.type === "ebb") {
    return "origin";
  }
  return {
    id: event.block.id,
    slot: event.block.slot,
  };
}

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
