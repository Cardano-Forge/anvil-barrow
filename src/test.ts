import { OgmiosSyncService } from "./ogmios";

const ogmios = new OgmiosSyncService({
  host: process.env.OGMIOS_NODE_HOST,
  port: Number(process.env.OGMIOS_NODE_PORT),
  tls: Boolean(process.env.OGMIOS_NODE_TLS),
});

(async () => {
  const service = ogmios;

  let processed = 0;
  for await (const event of service.sync()) {
    if (++processed > 3) {
      break;
    }
    console.log(event);
  }
})()
  .catch(console.error)
  .finally(() => process.exit(0));
