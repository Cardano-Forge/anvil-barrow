import {
  type ConnectionConfig,
  createChainSynchronizationClient,
  createInteractionContext,
  type Schema,
} from "@cardano-ogmios/client";
import type { SyncEvent } from "./types";

type Event = { event: SyncEvent; requestNext: () => void } | Error;

export class OgmiosSyncClient {
  constructor(private _config: ConnectionConfig) {}

  async *sync(points?: Schema.PointOrOrigin[]): AsyncIterable<SyncEvent> {
    const events: Array<Event> = [];
    let waitingResolve: (() => void) | null = null;

    const push = (
      item: { event: SyncEvent; requestNext: () => void } | Error,
    ) => {
      events.push(item);
      if (waitingResolve) {
        waitingResolve();
        waitingResolve = null;
      }
    };

    const context = await createInteractionContext(
      (error) => push(new Error(`ogmios error: ${error.message}`)),
      (code, reason) => push(new Error(`close ${code} ${reason}`)),
      { connection: this._config },
    );

    const client = await createChainSynchronizationClient(context, {
      rollForward: async ({ block, tip }, requestNext) => {
        const event: SyncEvent = { type: "apply", block, tip };
        push({ event, requestNext });
      },
      rollBackward: async ({ point, tip }, requestNext) => {
        const event: SyncEvent = { type: "reset", point, tip };
        push({ event, requestNext });
      },
    });

    try {
      await client.resume(points);
      while (true) {
        let item = events.shift();

        while (!item) {
          await new Promise<void>((resolve) => {
            waitingResolve = resolve;
          });
          item = events.shift();
        }

        if (item instanceof Error) {
          throw item;
        }

        yield item.event;
        item.requestNext();
      }
    } finally {
      await client.shutdown().catch(() => {
        // Client may already be shut down
      });
    }
  }
}
