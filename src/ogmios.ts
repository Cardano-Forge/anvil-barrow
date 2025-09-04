import {
  type ConnectionConfig,
  createChainSynchronizationClient,
  createInteractionContext,
} from "@cardano-ogmios/client";
import { isErr, parseError, wrap } from "trynot";
import { SocketClosedError, SocketError } from "./errors";
import type { SyncClient, SyncClientSyncOpts, SyncEvent } from "./types";

type Event = { event: SyncEvent; requestNext: () => void } | Error;

export class OgmiosSyncClient implements SyncClient {
  constructor(protected _config: ConnectionConfig) {}

  async *sync(opts: SyncClientSyncOpts = {}): AsyncGenerator<SyncEvent, void> {
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

    const context = await wrap(
      createInteractionContext(
        (error) => push(new Error(`ogmios error: ${error.message}`)),
        (code, reason) => push(new Error(`close ${code} ${reason}`)),
        { connection: this._config },
      ),
    );
    if (isErr(context)) {
      throw new SocketError(context.message, { cause: context });
    }

    const client = await wrap(
      createChainSynchronizationClient(context, {
        rollForward: async ({ block, tip }, requestNext) => {
          const event: SyncEvent = { type: "apply", block, tip };
          push({ event, requestNext });
        },
        rollBackward: async ({ point, tip }, requestNext) => {
          const event: SyncEvent = { type: "reset", point, tip };
          push({ event, requestNext });
        },
      }),
    );
    if (isErr(client)) {
      throw new SocketError(client.message, { cause: client });
    }

    try {
      const points = opts.point ? [opts.point] : undefined;
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
    } catch (exception) {
      const error = parseError(exception);
      if (error instanceof SocketError || error instanceof SocketClosedError) {
        throw error;
      }
      throw new SocketError(error.message, { cause: error });
    } finally {
      await client.shutdown().catch(() => {
        // Client may already be shut down
      });
    }
  }
}
