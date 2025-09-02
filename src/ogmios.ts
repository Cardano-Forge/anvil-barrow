import {
  createInteractionContext,
  createChainSynchronizationClient,
  Schema,
  ConnectionConfig,
} from "@cardano-ogmios/client";

type SyncEvent =
  | { type: "apply"; block: Schema.Block; tip: Schema.TipOrOrigin }
  | { type: "reset"; point: Schema.PointOrOrigin; tip: Schema.TipOrOrigin };

type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
};

function deferredPromise<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: any) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class OgmiosSyncService {
  constructor(private _config: ConnectionConfig) {}
  async *sync(): AsyncIterable<SyncEvent> {
    let eventPromise:
      | DeferredPromise<{ event: SyncEvent; requestNext: () => void }>
      | undefined = undefined;

    const context = await createInteractionContext(
      (error) => {
        eventPromise?.reject(error);
        eventPromise = undefined;
      },
      (code, reason) => {
        eventPromise?.reject(new Error(`close ${code} ${reason}`));
        eventPromise = undefined;
      },
      {
        connection: this._config,
      },
    );

    const client = await createChainSynchronizationClient(context, {
      rollForward: async ({ block, tip }, requestNext) => {
        console.log("apply", block.height);
        const event: SyncEvent = { type: "apply", block, tip };
        eventPromise?.resolve({ event, requestNext });
        eventPromise = undefined;
      },
      rollBackward: async ({ point, tip }, requestNext) => {
        console.log("reset", typeof point === "string" ? point : point.slot);
        const event: SyncEvent = { type: "reset", point, tip };
        eventPromise?.resolve({ event, requestNext });
        eventPromise = undefined;
      },
    });

    try {
      await client.resume();
      while (true) {
        eventPromise = deferredPromise();
        console.log("wait");
        const resolved = await eventPromise.promise;
        console.log("yield");
        yield resolved.event;
        console.log("next");
        resolved.requestNext();
      }
    } finally {
      console.log("shutdown");
      client.shutdown();
    }
  }
}
