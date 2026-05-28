import {
  type ConnectionConfig,
  createChainSynchronizationClient,
  createInteractionContext,
  type InteractionContext,
  type Schema as OgmiosSchemaNs,
} from "@cardano-ogmios/client";
import { isErr, wrap } from "trynot";
import { AbortError, SocketError } from "../../errors";
import { withController } from "../../generator";
import {
  type IndexerEvent,
  IndexerRunner,
  type IndexerRunnerDef,
  type IndexerSchema,
} from "../../indexer";
import { EventQueue } from "../../queue";
import type { MaybePromise } from "../../types";

export class OgmiosIndexer extends IndexerRunner<
  IndexerRunnerDef<OgmiosSchema>
> {
  constructor(protected opts: IndexerRunnerOpts) {
    super();
  }

  run(startOpts: IndexerRunnerDef<OgmiosSchema>["opts"]) {
    const controller = new AbortController();
    const queue = new EventQueue<QueueEvent>(controller);
    const ctx = { controller, queue, startOpts };
    const generator = createIndexerGenerator(this.opts, ctx);
    return withController(generator, controller);
  }
}

export async function* createIndexerGenerator(
  opts: IndexerRunnerOpts,
  ctx: IndexerRunnerContext,
) {
  const [client, interactionContext] = await createIndexerClient(opts, ctx);

  const runCtx = { opts, ctx, client, interactionContext };

  await opts.beforeRun?.(runCtx);

  let points: OgmiosSchemaNs.PointOrOrigin[] | undefined;
  if (ctx.startOpts.point !== "tip") points = [ctx.startOpts.point];

  try {
    await client.resume(points);

    while (true) {
      const item = await ctx.queue.next();
      if (item instanceof AbortError) return;
      if (item instanceof Error) throw item;
      yield item.event;
      item.requestNext();
    }
  } finally {
    await client.shutdown().catch(() => {
      // Client may already be shut down
    });
  }
}

export async function createIndexerClient(
  opts: { connection?: ConnectionConfig },
  ctx: { queue: EventQueue<QueueEvent> },
): Promise<[ChainSynchronizationClient, InteractionContext]> {
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

  const client = await wrap(
    createChainSynchronizationClient(context, {
      rollForward: async ({ block, tip }, requestNext) => {
        const event: IndexerEvent<OgmiosSchema> = {
          type: "apply",
          block,
          tip,
        };
        ctx.queue.push({ event, requestNext });
      },
      rollBackward: async ({ point, tip }, requestNext) => {
        const event: IndexerEvent<OgmiosSchema> = {
          type: "reset",
          point,
          tip,
        };
        ctx.queue.push({ event, requestNext });
      },
    }),
  );
  if (isErr(client)) {
    throw new SocketError(client.message, { cause: client });
  }

  return [client, context];
}

export type OgmiosSchema = IndexerSchema<
  OgmiosSchemaNs.Block,
  OgmiosSchemaNs.PointOrOrigin,
  OgmiosSchemaNs.PointOrOrigin | "tip",
  OgmiosSchemaNs.TipOrOrigin
>;

type QueueEvent =
  | { event: IndexerEvent<OgmiosSchema>; requestNext: () => void }
  | Error;

export type IndexerRunnerOpts = {
  connection: ConnectionConfig;
  beforeRun?(c: IndexerRunFnContext): MaybePromise<void>;
};

export type IndexerRunnerContext = {
  controller: AbortController;
  queue: EventQueue<QueueEvent>;
  startOpts: IndexerRunnerDef<OgmiosSchema>["opts"];
};

export type IndexerRunFnContext = {
  opts: IndexerRunnerOpts;
  ctx: IndexerRunnerContext;
  client: ChainSynchronizationClient;
  interactionContext: InteractionContext;
};

export type ChainSynchronizationClient = Awaited<
  ReturnType<typeof createChainSynchronizationClient>
>;
