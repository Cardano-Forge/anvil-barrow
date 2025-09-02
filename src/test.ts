import type { Schema } from "@cardano-ogmios/client";
import { OgmiosSyncService } from "./ogmios";

const ogmios = new OgmiosSyncService({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

(async () => {
  const service = ogmios;
  const points: Schema.PointOrOrigin[] = [
    {
      id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
      slot: 101163751,
    },
  ];

  let processed = 0;
  for await (const event of service.sync(points)) {
    if (++processed > 2) {
      break;
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
})()
  .catch(console.error)
  .finally(() => process.exit(0));
