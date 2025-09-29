import type {
  ConnectionConfig,
  InteractionContext,
  Schema,
} from "@cardano-ogmios/client";
import type { ChainSynchronizationClient } from "@cardano-ogmios/client/dist/ChainSynchronization";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { SocketError } from "../errors";
import { OgmiosSyncClient } from "./ogmios";

vi.mock("@cardano-ogmios/client", () => ({
  createInteractionContext: vi.fn(),
  createChainSynchronizationClient: vi.fn(),
}));

import {
  createChainSynchronizationClient,
  createInteractionContext,
} from "@cardano-ogmios/client";

describe("OgmiosSyncClient", () => {
  const mockConfig: ConnectionConfig = { host: "localhost", port: 1337 };

  let mockContext: InteractionContext;
  let mockClient: ChainSynchronizationClient;
  let errorHandler: ((error: Error) => void) | null = null;
  let closeHandler: ((code: number, reason: string) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {} as InteractionContext;
    mockClient = {
      resume: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChainSynchronizationClient;

    errorHandler = null;
    closeHandler = null;

    vi.mocked(createInteractionContext).mockImplementation(
      (onError, onClose, _config) => {
        errorHandler = onError;
        closeHandler = onClose;
        return Promise.resolve(mockContext);
      },
    );

    vi.mocked(createChainSynchronizationClient).mockResolvedValue(mockClient);
  });

  describe("constructor", () => {
    it("should create an instance with provided config", () => {
      const client = new OgmiosSyncClient(mockConfig);
      expect(client).toBeInstanceOf(OgmiosSyncClient);
    });
  });

  describe("sync", () => {
    it("should yield rollForward events as apply events", async () => {
      const mockBlock = { id: "block1", height: 100 } as Schema.Block;
      const mockTip = { height: 100, id: "tip1" } as Schema.Tip;

      vi.mocked(createChainSynchronizationClient).mockImplementation(
        async (_ctx, handlers) => {
          // Simulate a rollForward event after setup
          setTimeout(() => {
            handlers.rollForward({ block: mockBlock, tip: mockTip }, () => {
              mockClient.shutdown();
            });
          }, 10);
          return mockClient;
        },
      );

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      const result = await generator.next();

      expect(result.done).toBe(false);
      expect(result.value).toEqual({
        type: "apply",
        block: mockBlock,
        tip: mockTip,
      });

      await generator.return();
    });

    it("should yield rollBackward events as reset events", async () => {
      const mockPoint = { slot: 50, id: "point1" } as Schema.Point;
      const mockTip = { height: 100, id: "tip1" } as Schema.Tip;

      vi.mocked(createChainSynchronizationClient).mockImplementation(
        async (_ctx, handlers) => {
          setTimeout(() => {
            handlers.rollBackward({ point: mockPoint, tip: mockTip }, () => {
              mockClient.shutdown();
            });
          }, 10);
          return mockClient;
        },
      );

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      const result = await generator.next();

      expect(result.done).toBe(false);
      expect(result.value).toEqual({
        type: "reset",
        point: mockPoint,
        tip: mockTip,
      });

      await generator.return();
    });

    it("should yield multiple events in sequence", async () => {
      const mockBlock1 = { id: "block1", height: 100 } as Schema.Block;
      const mockBlock2 = { id: "block2", height: 101 } as Schema.Block;
      const mockTip = { height: 101, id: "tip1" } as Schema.Tip;

      vi.mocked(createChainSynchronizationClient).mockImplementation(
        async (_ctx, handlers) => {
          setTimeout(() => {
            handlers.rollForward({ block: mockBlock1, tip: mockTip }, () => {
              setTimeout(() => {
                handlers.rollForward(
                  { block: mockBlock2, tip: mockTip },
                  () => {},
                );
              }, 5);
            });
          }, 10);

          return mockClient;
        },
      );

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      const result1 = await generator.next();
      expect(result1.value).toEqual({
        type: "apply",
        block: mockBlock1,
        tip: mockTip,
      });

      const result2 = await generator.next();
      expect(result2.value).toEqual({
        type: "apply",
        block: mockBlock2,
        tip: mockTip,
      });

      await generator.return();
    });

    it("should resume from a specific point when provided", async () => {
      const mockPoint = { slot: 50, id: "point1" } as Schema.Point;
      const mockBlock = { id: "block1", height: 100 } as Schema.Block;
      const mockTip = { height: 100, id: "tip1" } as Schema.Tip;

      vi.mocked(createChainSynchronizationClient).mockImplementation(
        async (_ctx, handlers) => {
          setTimeout(() => {
            handlers.rollForward({ block: mockBlock, tip: mockTip }, () => {});
          }, 10);
          return mockClient;
        },
      );

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync({ point: mockPoint });

      await generator.next();

      expect(mockClient.resume).toHaveBeenCalledWith([mockPoint]);

      await generator.return();
    });

    it("should resume from origin when no point is provided", async () => {
      const mockBlock = { id: "block1", height: 100 } as Schema.Block;
      const mockTip = { height: 100, id: "tip1" } as Schema.Tip;

      vi.mocked(createChainSynchronizationClient).mockImplementation(
        async (_ctx, handlers) => {
          setTimeout(() => {
            handlers.rollForward({ block: mockBlock, tip: mockTip }, () => {});
          }, 10);
          return mockClient;
        },
      );

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      await generator.next();

      expect(mockClient.resume).toHaveBeenCalledWith(undefined);

      await generator.return();
    });

    it("should throw SocketError when createInteractionContext fails", async () => {
      const mockError = new Error("Connection failed");
      vi.mocked(createInteractionContext).mockRejectedValue(mockError);

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      await expect(generator.next()).rejects.toThrow(SocketError);
    });

    it("should throw SocketError when createChainSynchronizationClient fails", async () => {
      const mockError = new Error("Client creation failed");
      vi.mocked(createChainSynchronizationClient).mockRejectedValue(mockError);

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      await expect(generator.next()).rejects.toThrow(SocketError);
    });

    it("should handle error callback from interaction context", async () => {
      vi.mocked(createChainSynchronizationClient).mockImplementation(
        async (_ctx, _handlers) => {
          setTimeout(() => {
            if (errorHandler) {
              errorHandler(new Error("Ogmios error"));
            }
          }, 10);
          return mockClient;
        },
      );

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      await expect(generator.next()).rejects.toThrow("ogmios error");
    });

    it("should handle close callback from interaction context", async () => {
      vi.mocked(createChainSynchronizationClient).mockImplementation(
        async (_ctx, _handlers) => {
          setTimeout(() => {
            if (closeHandler) {
              closeHandler(1000, "Normal closure");
            }
          }, 10);
          return mockClient;
        },
      );

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      await expect(generator.next()).rejects.toThrow(
        "close 1000 Normal closure",
      );
    });

    it("should call shutdown on client when generator is done", async () => {
      const mockBlock = { id: "block1", height: 100 } as Schema.Block;
      const mockTip = { height: 100, id: "tip1" } as Schema.Tip;

      vi.mocked(createChainSynchronizationClient).mockImplementation(
        async (_ctx, handlers) => {
          setTimeout(() => {
            handlers.rollForward({ block: mockBlock, tip: mockTip }, () => {});
          }, 10);
          return mockClient;
        },
      );

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      await generator.next();
      await generator.return();

      expect(mockClient.shutdown).toHaveBeenCalled();
    });

    it("should call shutdown even if shutdown fails", async () => {
      const mockBlock = { id: "block1", height: 100 } as Schema.Block;
      const mockTip = { height: 100, id: "tip1" } as Schema.Tip;

      (
        mockClient.shutdown as Mock<typeof mockClient.shutdown>
      ).mockRejectedValue(new Error("Shutdown failed"));

      vi.mocked(createChainSynchronizationClient).mockImplementation(
        async (_ctx, handlers) => {
          setTimeout(() => {
            handlers.rollForward({ block: mockBlock, tip: mockTip }, () => {});
          }, 10);
          return mockClient;
        },
      );

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      await generator.next();

      await generator.return();

      expect(mockClient.shutdown).toHaveBeenCalled();
    });

    it("should wrap non-SocketError exceptions in SocketError", async () => {
      const mockError = new Error("Generic error");

      vi.mocked(createChainSynchronizationClient).mockRejectedValue(mockError);

      const client = new OgmiosSyncClient(mockConfig);
      const generator = client.sync();

      await expect(generator.next()).rejects.toThrow(SocketError);
    });
  });
});
