import {
  type ConnectionConfig,
  createChainSynchronizationClient,
  createInteractionContext,
  type Schema,
} from "@cardano-ogmios/client";
import { deferredPromise } from "./lib/deferred-promise";
import type { SyncEvent, SyncService } from "./types";

export class OgmiosSyncService implements SyncService {
  constructor(private _config: ConnectionConfig) {}

  async *sync(points?: Schema.PointOrOrigin[]): AsyncIterable<SyncEvent> {
    let eventPromise = deferredPromise<{
      event: SyncEvent;
      requestNext: () => void;
    }>();

    const context = await createInteractionContext(
      (error) => {
        eventPromise.reject(error);
      },
      (code, reason) => {
        eventPromise.reject(new Error(`close ${code} ${reason}`));
      },
      {
        connection: this._config,
      },
    );

    const client = await createChainSynchronizationClient(context, {
      rollForward: async ({ block, tip }, requestNext) => {
        const event: SyncEvent = { type: "apply", block, tip };
        eventPromise.resolve({ event, requestNext });
      },
      rollBackward: async ({ point, tip }, requestNext) => {
        const event: SyncEvent = { type: "reset", point, tip };
        eventPromise.resolve({ event, requestNext });
      },
    });

    try {
      await client.resume(points);
      while (true) {
        const resolved = await eventPromise.promise;
        eventPromise = deferredPromise();
        yield resolved.event;
        resolved.requestNext();
      }
    } finally {
      client.shutdown();
    }
  }
}
