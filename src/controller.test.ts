import { isErr, isOk } from "trynot";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "./controller";
import { ErrorHandler } from "./error-handler";
import { ProcessingError } from "./errors";
import type { Schema, SyncClient, SyncEvent } from "./types";

describe("Controller", () => {
  let mockSyncClient: SyncClient<Schema>;
  let mockGenerator: AsyncGenerator<SyncEvent<Schema>, void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerator = (async function* () {})();
    mockSyncClient = {
      sync: vi.fn(() => mockGenerator),
    };
  });

  describe("constructor", () => {
    it("should create controller with required config", () => {
      const controller = new Controller({ syncClient: mockSyncClient });
      expect(controller).toBeDefined();
      expect(controller.state.status).toBe("idle");
    });
  });

  describe("start", () => {
    it("should start controller from idle state", async () => {
      const controller = new Controller({ syncClient: mockSyncClient });
      const result = await controller.start({ fn: vi.fn() });
      assert(isOk(result));
      expect(result.status).toBe("running");
    });

    it("should return error if already running", async () => {
      mockGenerator = (async function* () {
        await new Promise(() => {}); // Never resolves
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: vi.fn() });
      const result = await controller.start({ fn: vi.fn() });
      assert(isErr(result));
    });

    it("should initialize counters to zero", async () => {
      const controller = new Controller({ syncClient: mockSyncClient });
      const result = await controller.start({ fn: vi.fn() });
      assert(isOk(result));
      expect(result.counters.applyCount).toBe(0);
      expect(result.counters.resetCount).toBe(0);
      expect(result.counters.filterCount).toBe(0);
      expect(result.counters.errorCount).toBe(0);
    });

    it("should call syncClient.sync with point", async () => {
      const controller = new Controller({ syncClient: mockSyncClient });
      const point = { slot: 100, id: "abc123" };

      await controller.start({ fn: vi.fn(), point });

      expect(mockSyncClient.sync).toHaveBeenCalledWith({ point });
    });
  });

  describe("pause", () => {
    it("should pause running controller", async () => {
      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: async () => {} });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await controller.pause();
      assert(isOk(result));
      expect(result.status).toBe("paused");
    });

    it("should return error if not running", async () => {
      const controller = new Controller({ syncClient: mockSyncClient });
      const result = await controller.pause();
      assert(isErr(result));
    });
  });

  describe("resume", () => {
    it("should resume paused controller", async () => {
      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: async () => {} });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await controller.pause();

      const result = await controller.resume();
      assert(isOk(result));
      expect(result.status).toBe("running");
    });

    it("should return error if not paused", async () => {
      const controller = new Controller({ syncClient: mockSyncClient });
      const result = await controller.resume();
      assert(isErr(result));
    });
  });

  describe("waitForCompletion", () => {
    it("should return error when not running", async () => {
      const controller = new Controller({ syncClient: mockSyncClient });
      const result = await controller.waitForCompletion();
      assert(isErr(result));
    });

    it("should wait for completion when running", async () => {
      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: async () => ({ done: true }) });

      const result = await controller.waitForCompletion();
      assert(isOk(result));
    });
  });

  describe("event processing", () => {
    it("should process apply events", async () => {
      const mockFn = vi.fn();
      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: mockFn });
      await controller.waitForCompletion();

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should filter events when filter returns false", async () => {
      const mockFn = vi.fn();
      const mockFilter = vi.fn().mockResolvedValue(false);

      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: mockFn, filter: mockFilter });
      await controller.waitForCompletion();

      expect(mockFilter).toHaveBeenCalledTimes(1);
      expect(mockFn).not.toHaveBeenCalled();

      assert(controller.state.status !== "idle");
      expect(controller.state.counters.filterCount).toBe(1);
    });

    it("should stop when fn returns done: true", async () => {
      const mockFn = vi.fn().mockResolvedValue({ done: true });
      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "2", height: 2, slot: 2 },
          tip: { slot: 2, id: "2", height: 2 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: mockFn });
      await controller.waitForCompletion();

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(controller.state.status).toBe("done");
    });

    it("should stop when takeUntil returns true", async () => {
      const mockFn = vi.fn();
      const mockTakeUntil = vi.fn().mockResolvedValue(true);

      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "2", height: 2, slot: 2 },
          tip: { slot: 2, id: "2", height: 2 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: mockFn, takeUntil: mockTakeUntil });
      await controller.waitForCompletion();

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockTakeUntil).toHaveBeenCalledTimes(1);
      expect(controller.state.status).toBe("done");
    });

    it("should increment apply counter", async () => {
      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: async () => {} });
      await controller.waitForCompletion();

      assert(controller.state.status !== "idle");
      expect(controller.state.counters.applyCount).toBe(1);
    });

    it("should increment reset counter", async () => {
      mockGenerator = (async function* () {
        yield {
          type: "reset",
          point: { slot: 1, id: "1" },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: async () => {} });
      await controller.waitForCompletion();

      assert(controller.state.status !== "idle");
      expect(controller.state.counters.resetCount).toBe(1);
    });
  });

  describe("error handling", () => {
    it("should handle errors from processing function", async () => {
      const cause = new Error("Fn error");
      const mockFn = vi.fn().mockRejectedValue(cause);
      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: {
            type: "praos",
            era: "babbage",
            id: "1",
            height: 1,
            slot: 1,
          },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({ syncClient: mockSyncClient });
      await controller.start({ fn: mockFn });
      await controller.waitForCompletion();

      assert(controller.state.status === "crashed");
      expect(controller.state.counters.errorCount).toBe(1);
      assert(controller.state.meta.lastError instanceof ProcessingError);
      assert("cause" in controller.state.meta.lastError);
      expect(controller.state.meta.lastError.cause).toBe(cause);
    });

    it("should retry on error when handler returns retry", async () => {
      let callCount = 0;
      const mockFn = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("Temporary error");
      });

      mockSyncClient.sync = vi.fn(() => {
        return (async function* () {
          yield {
            type: "apply",
            block: {
              type: "praos",
              era: "babbage",
              id: "1",
              height: 1,
              slot: 1,
            },
            tip: { slot: 1, id: "1", height: 1 },
          } as const;
        })();
      });

      const errorHandler = new ErrorHandler(
        ErrorHandler.retry({ maxRetries: 1 }),
      );
      const controller = new Controller({
        syncClient: mockSyncClient,
        errorHandler,
      });

      await controller.start({ fn: mockFn });
      await controller.waitForCompletion();

      expect(mockFn).toHaveBeenCalledTimes(2);
      expect(mockSyncClient.sync).toHaveBeenCalledTimes(2);
    });
  });

  describe("event handler", () => {
    it("should call event handler on controller events", async () => {
      const mockEventHandler = vi.fn();
      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({
        syncClient: mockSyncClient,
        eventHandler: mockEventHandler,
      });

      await controller.start({ fn: async () => {} });
      await controller.waitForCompletion();

      expect(mockEventHandler).toHaveBeenCalled();
      const startedEvent = mockEventHandler.mock.calls.find(
        (call) => call[0].type === "controller.started",
      );
      expect(startedEvent).toBeDefined();
    });

    it("should not crash if event handler throws", async () => {
      const mockEventHandler = vi.fn().mockImplementation(() => {
        throw new Error("Event handler error");
      });
      mockGenerator = (async function* () {
        yield {
          type: "apply",
          block: { type: "praos", era: "babbage", id: "1", height: 1, slot: 1 },
          tip: { slot: 1, id: "1", height: 1 },
        };
      })();
      mockSyncClient.sync = vi.fn(() => mockGenerator);

      const controller = new Controller({
        syncClient: mockSyncClient,
        eventHandler: mockEventHandler,
      });

      await controller.start({ fn: async () => {} });
      await controller.waitForCompletion();

      expect(controller.state.status).not.toBe("crashed");
    });
  });
});
