import {
  type ConnectionConfig,
  createInteractionContext,
  createMempoolMonitoringClient,
} from "@cardano-ogmios/client";
import { isErr, parseError, wrap } from "trynot";
import { SocketClosedError, SocketError } from "../../errors";
import type { Counters, Runner, RunnerDef } from "../../types";

type MempoolEvent = { type: "txs"; txs: string[] };

type Event = { event: MempoolEvent } | Error;

export type MempoolRunnerDef = RunnerDef<
  Record<string, unknown>,
  Record<string, unknown>,
  MempoolEvent
>;

export class OgmiosMempool implements Runner<MempoolRunnerDef> {
  constructor(protected _config: ConnectionConfig) {}

  createMeta(): Record<string, unknown> {
    return {};
  }

  createCounters(): Counters<MempoolEvent> {
    return { txsCount: 0 };
  }

  resume() {
    return this.run();
  }

  run() {
    const events: Array<Event> = [];
    let waitingResolve: ((status: { returned: boolean }) => void) | null = null;

    const push = (item: Event) => {
      events.push(item);
      if (waitingResolve) {
        waitingResolve({ returned: false });
        waitingResolve = null;
      }
    };

    async function* _run(config: ConnectionConfig) {
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
          client
            .acquireMempool()
            .then(async () => {
              const txs: string[] = [];
              let txHash = await client.nextTransaction();
              while (txHash) {
                txs.push(txHash);
                txHash = await client.nextTransaction();
              }
              push({ event: { type: "txs", txs } });
            })
            .catch((error) => {
              push(parseError(error));
            });

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

    const generator = _run(this._config);

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
