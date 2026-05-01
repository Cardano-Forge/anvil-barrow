import {
  type ConnectionConfig,
  createInteractionContext,
  createMempoolMonitoringClient,
} from "@cardano-ogmios/client";
import { isErr, parseError, wrap } from "trynot";
import { SocketClosedError, SocketError } from "../errors";
import type { Schema, SyncClient, SyncEvent } from "../types";

export type MempoolSchema = Schema<
  { type: "ebb"; era: "byron"; id: string; height: number },
  string,
  string,
  string
>;

type Event = { event: SyncEvent<MempoolSchema> } | Error;

export class MempoolSyncClient implements SyncClient<MempoolSchema> {
  constructor(protected _config: ConnectionConfig) {}

  sync() {
    const events: Array<Event> = [];
    let waitingResolve: ((status: { returned: boolean }) => void) | null = null;

    const push = (item: Event) => {
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

      const client = await wrap(createMempoolMonitoringClient(context));
      if (isErr(client)) {
        throw new SocketError(client.message, { cause: client });
      }

      try {
        while (true) {
          console.log("ACQUIRING");
          client
            .acquireMempool()
            .then(async () => {
              console.log("getting next tx");
              const txs: string[] = [];
              let txHash = await client.nextTransaction();
              while (txHash) {
                console.log("txHash", txHash);
                txs.push(txHash);
                txHash = await client.nextTransaction();
              }
              push({
                event: {
                  type: "reset",
                  point: txs.length.toString(),
                  tip: JSON.stringify(txs),
                },
              });
              console.log("done");
            })
            .catch((error) => {
              push(parseError(error));
            });

          let item = events.shift();

          while (!item) {
            console.log("NO ITEM! WAITING");
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
