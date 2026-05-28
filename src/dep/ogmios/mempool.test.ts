import type { InteractionContext, Schema } from "@cardano-ogmios/client";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { SocketError } from "../../errors";
import { EventQueue } from "../../queue";
import {
  createMempoolGenerator,
  enqueueNextMempoolEvent,
  getIdentityTxParser,
  type MempoolMonitoringClient,
  type MempoolRunnerContext,
  type MempoolRunnerOpts,
  OgmiosMempool,
} from "./mempool";

vi.mock("@cardano-ogmios/client", () => ({
  createInteractionContext: vi.fn(),
  createMempoolMonitoringClient: vi.fn(),
}));

import {
  createInteractionContext,
  createMempoolMonitoringClient,
} from "@cardano-ogmios/client";

describe("OgmiosMempool", () => {
  const mockOpts: MempoolRunnerOpts = {
    connection: { host: "localhost", port: 1337 },
    parser: getIdentityTxParser(),
  };

  let mockContext: InteractionContext;
  let mockClient: MempoolMonitoringClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {} as InteractionContext;
    mockClient = {
      acquireMempool: vi.fn().mockResolvedValue(undefined),
      nextTransaction: vi.fn().mockResolvedValue(null),
      releaseMempool: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as MempoolMonitoringClient;

    vi.mocked(createInteractionContext).mockResolvedValue(mockContext);
    vi.mocked(createMempoolMonitoringClient).mockResolvedValue(mockClient);
  });

  describe("constructor", () => {
    it("should create an instance with provided config", () => {
      const runner = new OgmiosMempool(mockOpts);
      expect(runner).toBeInstanceOf(OgmiosMempool);
    });
  });

  describe("run", () => {
    it("should yield txs events with added and dropped txs", async () => {
      const tx1 = { id: "tx1" } as Schema.Transaction;

      const createClient = vi.fn().mockResolvedValue([mockClient, mockContext]);

      let callCount = 0;
      vi.mocked(mockClient.nextTransaction).mockImplementation(() => {
        if (callCount === 0) {
          callCount++;
          return Promise.resolve(tx1);
        }
        return Promise.resolve(null);
      });

      const runner = new OgmiosMempool(mockOpts);
      const generator = runner.run(undefined, (opts, ctx) =>
        createMempoolGenerator(opts, ctx, createClient),
      );

      const result = await generator.next();

      expect(result.done).toBe(false);
      expect(result.value).toEqual({
        type: "txs",
        added: [tx1],
        dropped: [],
      });

      await generator.return();
    });

    it("should throw SocketError when createInteractionContext fails", async () => {
      vi.mocked(createInteractionContext).mockRejectedValue(
        new Error("Connection failed"),
      );

      const runner = new OgmiosMempool(mockOpts);
      const generator = runner.run();

      await expect(generator.next()).rejects.toThrow(SocketError);
    });

    it("should throw SocketError when createMempoolMonitoringClient fails", async () => {
      vi.mocked(createMempoolMonitoringClient).mockRejectedValue(
        new Error("Client creation failed"),
      );

      const runner = new OgmiosMempool(mockOpts);
      const generator = runner.run();

      await expect(generator.next()).rejects.toThrow(SocketError);
    });

    it("should call shutdown on client when generator is done", async () => {
      const createClient = vi.fn().mockResolvedValue([mockClient, mockContext]);

      const runner = new OgmiosMempool(mockOpts);
      const generator = runner.run(undefined, (opts, ctx) =>
        createMempoolGenerator(opts, ctx, createClient),
      );

      await generator.next();
      await generator.return();

      expect(mockClient.shutdown).toHaveBeenCalled();
    });

    it("should call shutdown even if shutdown fails", async () => {
      (mockClient.shutdown as Mock).mockRejectedValue(
        new Error("Shutdown failed"),
      );

      const createClient = vi.fn().mockResolvedValue([mockClient, mockContext]);

      const runner = new OgmiosMempool(mockOpts);
      const generator = runner.run(undefined, (opts, ctx) =>
        createMempoolGenerator(opts, ctx, createClient),
      );

      await generator.next();
      await expect(generator.return()).resolves.not.toThrow();

      expect(mockClient.shutdown).toHaveBeenCalled();
    });

    it("should call beforeRun if provided", async () => {
      const beforeRun = vi.fn().mockResolvedValue(undefined);
      const createClient = vi.fn().mockResolvedValue([mockClient, mockContext]);

      const runner = new OgmiosMempool({ ...mockOpts, beforeRun });
      const generator = runner.run(undefined, (opts, ctx) =>
        createMempoolGenerator(opts, ctx, createClient),
      );

      await generator.next();

      expect(beforeRun).toHaveBeenCalledOnce();

      await generator.return();
    });

    it("should seed oldTxs from getExistingTxs", async () => {
      const existingTx = { id: "existing" } as Schema.Transaction;
      const getExistingTxs = vi.fn().mockResolvedValue([existingTx]);
      const createClient = vi.fn().mockResolvedValue([mockClient, mockContext]);

      const runner = new OgmiosMempool({ ...mockOpts, getExistingTxs });
      const generator = runner.run(undefined, (opts, ctx) =>
        createMempoolGenerator(opts, ctx, createClient),
      );

      const result = await generator.next();

      // existing tx not in new snapshot -> dropped
      expect(result.value).toEqual({
        type: "txs",
        added: [],
        dropped: [existingTx],
      });

      await generator.return();
    });
  });
});

describe("enqueueNextMempoolEvent", () => {
  const parser = getIdentityTxParser();

  function makeCtx() {
    const controller = new AbortController();
    const queue = new EventQueue(controller);
    return { controller, queue } as MempoolRunnerContext;
  }

  it("should push event with added txs", async () => {
    const tx = { id: "tx1" } as Schema.Transaction;
    const client = {
      acquireMempool: vi.fn().mockResolvedValue(undefined),
      nextTransaction: vi
        .fn()
        .mockResolvedValueOnce(tx)
        .mockResolvedValueOnce(null),
      shutdown: vi.fn(),
    } as unknown as MempoolMonitoringClient;

    const opts: MempoolRunnerOpts = {
      connection: { host: "localhost", port: 1337 },
      parser,
    };
    const ctx = makeCtx();
    const state = { client, oldTxs: new Map() };

    await enqueueNextMempoolEvent(opts, ctx, state);

    const item = await ctx.queue.next();
    expect(item).toMatchObject({
      event: { type: "txs", added: [tx], dropped: [] },
    });
  });

  it("should push event with dropped txs", async () => {
    const oldTx = { id: "tx1" } as Schema.Transaction;
    const client = {
      acquireMempool: vi.fn().mockResolvedValue(undefined),
      nextTransaction: vi.fn().mockResolvedValue(null),
      shutdown: vi.fn(),
    } as unknown as MempoolMonitoringClient;

    const opts: MempoolRunnerOpts = {
      connection: { host: "localhost", port: 1337 },
      parser,
    };
    const ctx = makeCtx();
    const state = {
      client,
      oldTxs: new Map([["tx1", oldTx]]),
    };

    await enqueueNextMempoolEvent(opts, ctx, state);

    const item = await ctx.queue.next();
    expect(item).toMatchObject({
      event: { type: "txs", added: [], dropped: [oldTx] },
    });
  });

  it("should push error when acquireMempool throws", async () => {
    const client = {
      acquireMempool: vi.fn().mockRejectedValue(new Error("acquire failed")),
      nextTransaction: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as MempoolMonitoringClient;

    const opts: MempoolRunnerOpts = {
      connection: { host: "localhost", port: 1337 },
      parser,
    };
    const ctx = makeCtx();
    const state = { client, oldTxs: new Map() };

    await enqueueNextMempoolEvent(opts, ctx, state);

    const item = await ctx.queue.next();
    expect(item).toBeInstanceOf(Error);
  });
});

describe("getIdentityTxParser", () => {
  it("should return the tx as-is", async () => {
    const parser = getIdentityTxParser();
    const tx = { id: "tx1" } as Schema.Transaction;
    expect(await parser.parseTx(tx)).toBe(tx);
  });

  it("should return tx.id as hash", () => {
    const parser = getIdentityTxParser();
    const tx = { id: "abc123" } as Schema.Transaction;
    expect(parser.getTxHash(tx)).toBe("abc123");
  });
});
