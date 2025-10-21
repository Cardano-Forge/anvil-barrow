import {
  type ConnectionConfig,
  createChainSynchronizationClient,
  createInteractionContext,
  type Schema as OgmiosSchemaNs,
} from "@cardano-ogmios/client";
import { isErr, parseError, wrap } from "trynot";
import { SocketClosedError, SocketError } from "../errors";
import type {
  Schema,
  SyncClient,
  SyncClientSyncOpts,
  SyncEvent,
} from "../types";

export type OgmiosSchema = Schema<
  OgmiosSchemaNs.Block,
  OgmiosSchemaNs.PointOrOrigin,
  OgmiosSchemaNs.PointOrOrigin | "tip",
  OgmiosSchemaNs.TipOrOrigin
>;

type Event =
  | { event: SyncEvent<OgmiosSchema>; requestNext: () => void }
  | Error;

export class OgmiosSyncClient implements SyncClient<OgmiosSchema> {
  constructor(protected _config: ConnectionConfig) {}

  sync(opts: SyncClientSyncOpts<OgmiosSchema>) {
    const events: Array<Event> = [];
    let waitingResolve: ((status: { returned: boolean }) => void) | null = null;

    const push = (
      item: { event: SyncEvent<OgmiosSchema>; requestNext: () => void } | Error,
    ) => {
      events.push(item);
      if (waitingResolve) {
        waitingResolve({ returned: false });
        waitingResolve = null;
      }
    };

    async function* _sync(config: ConnectionConfig) {
      const context = await wrap(
        createInteractionContext(
          (error) => push(new Error(`ogmios error: ${error.message}`)),
          (code, reason) => push(new Error(`close ${code} ${reason}`)),
          { connection: config },
        ),
      );
      if (isErr(context)) {
        throw new SocketError(context.message, { cause: context });
      }

      const client = await wrap(
        createChainSynchronizationClient(context, {
          rollForward: async ({ block, tip }, requestNext) => {
            const event: SyncEvent<OgmiosSchema> = {
              type: "apply",
              block,
              tip,
            };
            push({ event, requestNext });
          },
          rollBackward: async ({ point, tip }, requestNext) => {
            const event: SyncEvent<OgmiosSchema> = {
              type: "reset",
              point,
              tip,
            };
            push({ event, requestNext });
          },
        }),
      );
      if (isErr(client)) {
        throw new SocketError(client.message, { cause: client });
      }
      try {
        const points = opts.point === "tip" ? undefined : [opts.point];
        await client.resume(points);
        while (true) {
          let item = events.shift();

          while (!item) {
            const status = await new Promise<{ returned: boolean }>(
              (resolve) => {
                waitingResolve = resolve;
              },
            );
            if (status.returned) {
              return;
            }
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
        if (
          error instanceof SocketError ||
          error instanceof SocketClosedError
        ) {
          throw error;
        }
        throw new SocketError(error.message, { cause: error });
      } finally {
        await client.shutdown().catch(() => {
          // Client may already be shut down
        });
      }
    }

    const generator = _sync(this._config);

    // Stop running generator when generator is manually stopped
    const generatorReturn = generator.return;
    generator.return = () => {
      const res = generatorReturn.call(generator);
      if (waitingResolve) {
        waitingResolve({ returned: true });
        waitingResolve = null;
      }
      return res;
    };

    return generator;
  }
}
