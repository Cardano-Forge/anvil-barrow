import {
  createInteractionContext,
  createChainSynchronizationClient,
} from "@cardano-ogmios/client";

type Point = {
  height: number;
};

class OgmiosSyncService {
  async sync(c: { start: Point }) {
    const context = await createInteractionContext(
      (error) => {
        console.error("error", error);
      },
      (code, reason) => {
        console.error("close", code, reason);
      },
      {
        connection: {
          host: process.env.OGMIOS_NODE_HOST,
          port: Number(process.env.OGMIOS_NODE_PORT),
          tls: Boolean(process.env.OGMIOS_NODE_TLS),
        },
      },
    );

    const client = await createChainSynchronizationClient(context, {
      rollForward: async ({ block, tip }, requestNextBlock) => {
        console.log("forward");
      },
      rollBackward: async ({ point, tip }, requestNextBlock) => {
        console.log("backward");
      },
    });

    const { intersection, tip } = await client.resume(points);
  }
}
