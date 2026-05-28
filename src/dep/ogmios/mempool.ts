import {
  type ConnectionConfig,
  createInteractionContext,
  createMempoolMonitoringClient,
  type InteractionContext,
  type Schema,
} from "@cardano-ogmios/client";
import type { MempoolMonitoringClient } from "@cardano-ogmios/client/dist/MempoolMonitoring";
import { isErr, parseError, wrap } from "trynot";
import { AbortError, SocketError } from "../../errors";
import { withController } from "../../generator";
import { identity } from "../../lib/identity";
import { EventQueue } from "../../queue";
import type { Counters, MaybePromise, Runner, RunnerDef } from "../../types";

export class OgmiosMempool<TParsedTx = Schema.Transaction>
  implements Runner<MempoolRunnerDef<TParsedTx>>
{
  constructor(protected opts: MempoolRunnerOpts<TParsedTx>) {}

  createMeta() {
    return {};
  }

  createCounters(): Counters<MempoolEvent<TParsedTx>> {
    return { txsCount: 0 };
  }

  resume() {
    return this.run();
  }

  run() {
    const controller = new AbortController();
    const queue = new EventQueue<QueueEvent<TParsedTx>>(controller);
    const generator = makeMempoolGenerator(this.opts, { controller, queue });
    return withController(generator, controller);
  }
}

export async function* makeMempoolGenerator<TParsedTx = Schema.Transaction>(
  opts: MempoolRunnerOpts<TParsedTx>,
  ctx: MempoolRunnerContext<TParsedTx>,
) {
  const [client, interactionContext] = await createMempoolClient(opts, ctx);

  const runCtx = { opts, ctx, client, interactionContext };

  await opts.beforeRun?.(runCtx);

  const existing = await opts.getExistingTxs?.(runCtx);

  let oldTxs = new Map(existing?.map((tx) => [opts.parser.getTxHash(tx), tx]));

  try {
    while (true) {
      const state = { oldTxs, client };
      enqueueNextMempoolEvent(opts, ctx, state);
      const item = await ctx.queue.next();
      if (item instanceof AbortError) return;
      if (item instanceof Error) throw item;
      oldTxs = item.newTxs;
      yield item.event;
    }
  } finally {
    await client.shutdown().catch(() => {
      // Client may already be shut down
    });
  }
}

export async function createMempoolClient<TEvent>(
  opts: { connection?: ConnectionConfig },
  ctx: { queue: EventQueue<TEvent | Error> },
): Promise<[MempoolMonitoringClient, InteractionContext]> {
  const context = await wrap(
    createInteractionContext(
      (error) => ctx.queue.push(new Error(`ogmios error: ${error.message}`)),
      (code, reason) => ctx.queue.push(new Error(`close ${code} ${reason}`)),
      opts,
    ),
  );
  if (isErr(context)) {
    throw new SocketError(context.message, { cause: context });
  }

  const client = await wrap(createMempoolMonitoringClient(context));
  if (isErr(client)) {
    throw new SocketError(client.message, { cause: client });
  }

  return [client, context];
}

export async function enqueueNextMempoolEvent<TParsedTx = Schema.Transaction>(
  opts: MempoolRunnerOpts<TParsedTx>,
  ctx: MempoolRunnerContext<TParsedTx>,
  state: MempoolRunnerState<TParsedTx>,
): Promise<void> {
  try {
    await state.client.acquireMempool();

    const added: TParsedTx[] = [];
    const newTxs = new Map<string, TParsedTx>();

    let tx = await state.client.nextTransaction({ fields: "all" });
    while (tx) {
      const parsed = await opts.parser.parseTx(tx);
      const txHash = opts.parser.getTxHash(parsed);
      newTxs.set(txHash, parsed);
      if (!state.oldTxs.has(tx.id)) {
        added.push(parsed);
      }
      tx = await state.client.nextTransaction({ fields: "all" });
    }

    const dropped: TParsedTx[] = [];
    for (const [txHash, tx] of state.oldTxs) {
      if (!newTxs.has(txHash)) {
        dropped.push(tx);
      }
    }

    await ctx.queue.push({
      event: { type: "txs", dropped, added },
      newTxs,
    });
  } catch (error) {
    await ctx.queue.push(parseError(error));
  }
}

export type TxParser<TParsedTx = Schema.Transaction> = {
  parseTx(tx: Schema.Transaction): MaybePromise<TParsedTx>;
  getTxHash(tx: TParsedTx): string;
};

export function getIdentityTxParser(): TxParser {
  return {
    parseTx: identity,
    getTxHash: (tx) => tx.id,
  };
}

export type MempoolEvent<TParsedTx = Schema.Transaction> = {
  type: "txs";
  dropped: TParsedTx[];
  added: TParsedTx[];
};

export type MempoolRunnerDef<TParsedTx = Schema.Transaction> = RunnerDef<
  Record<string, unknown>,
  Record<string, unknown>,
  MempoolEvent<TParsedTx>
>;

export type MempoolRunnerOpts<TParsedTx = Schema.Transaction> = {
  connection: ConnectionConfig;
  parser: TxParser<TParsedTx>;
  beforeRun?(c: MempoolRunFnContext<TParsedTx>): MaybePromise<void>;
  getExistingTxs?(c: MempoolRunFnContext<TParsedTx>): MaybePromise<TParsedTx[]>;
};

export type MempoolRunnerContext<TParsedTx = Schema.Transaction> = {
  controller: AbortController;
  queue: EventQueue<QueueEvent<TParsedTx>>;
};

export type MempoolRunnerState<TParsedTx = Schema.Transaction> = {
  client: MempoolMonitoringClient;
  oldTxs: Map<string, TParsedTx>;
};

export type MempoolRunFnContext<TParsedTx = Schema.Transaction> = {
  opts: MempoolRunnerOpts<TParsedTx>;
  ctx: MempoolRunnerContext<TParsedTx>;
  client: MempoolMonitoringClient;
  interactionContext: InteractionContext;
};

export type QueueEvent<TParsedTx = Schema.Transaction> =
  | {
      event: MempoolEvent<TParsedTx>;
      newTxs: Map<string, TParsedTx>;
    }
  | Error;
