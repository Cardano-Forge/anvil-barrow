import { assert, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorHandler, type HandlerResult } from "./error-handler";

describe("ErrorHandler", () => {
  describe("constructor", () => {
    it("should create an empty handler", () => {
      const handler = new ErrorHandler();
      expect(handler).toBeDefined();
    });

    it("should register handlers passed to constructor", async () => {
      const mockHandler = vi.fn(() => ({ retry: {} }));
      const handler = new ErrorHandler(mockHandler);

      await handler.handle(new Error("test"));

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should register multiple handlers in constructor", async () => {
      const mockHandler1 = vi.fn();
      const mockHandler2 = vi.fn(() => ({ retry: {} }));
      const handler = new ErrorHandler(mockHandler1, mockHandler2);

      await handler.handle(new Error("test"));

      expect(mockHandler1).toHaveBeenCalledTimes(1);
      expect(mockHandler2).toHaveBeenCalledTimes(1);
    });
  });

  describe("register", () => {
    let handler: ErrorHandler;

    beforeEach(() => {
      handler = new ErrorHandler();
    });

    it("should register a handler without filter", async () => {
      const mockHandler = vi.fn(() => ({ retry: {} }));
      handler.register(mockHandler);

      await handler.handle(new Error("test"));

      expect(mockHandler).toHaveBeenCalledWith(expect.any(Error));
    });

    it("should register a handler with class filter", async () => {
      class CustomError extends Error {}
      const mockHandler = vi.fn(() => ({ retry: {} }));

      handler.register(CustomError, mockHandler);

      await handler.handle(new CustomError("custom"));
      expect(mockHandler).toHaveBeenCalledTimes(1);

      await handler.handle(new Error("standard"));
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should register a handler with function filter", async () => {
      const mockHandler = vi.fn(() => ({ retry: {} }));
      const filter = (error: unknown) =>
        error instanceof Error && error.message.includes("network");

      handler.register(filter, mockHandler);

      await handler.handle(new Error("network error"));
      expect(mockHandler).toHaveBeenCalledTimes(1);

      await handler.handle(new Error("other error"));
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should return ErrorHandler for chaining", () => {
      const result = handler.register(() => {});
      expect(result).toBe(handler);
    });

    it("should register builtin retry handler", async () => {
      const retryHandler = ErrorHandler.retry({ maxRetries: 2 });
      handler.register(retryHandler);

      const result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: undefined } });
    });
  });

  describe("handle", () => {
    let handler: ErrorHandler;

    beforeEach(() => {
      handler = new ErrorHandler();
    });

    it("should return undefined when no handlers registered", async () => {
      const result = await handler.handle(new Error("test"));
      expect(result).toBeUndefined();
    });

    it("should call handler with error", async () => {
      const mockHandler = vi.fn();
      handler.register(mockHandler);

      const error = new Error("test");
      await handler.handle(error);

      expect(mockHandler).toHaveBeenCalledWith(error);
    });

    it("should return result from first matching handler", async () => {
      const handler1 = vi.fn(() => ({ retry: { delay: 100 } }));
      const handler2 = vi.fn(() => ({ retry: { delay: 200 } }));

      handler.register(handler1).register(handler2);

      const result = await handler.handle(new Error("test"));

      expect(result).toEqual({ retry: { delay: 100 } });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });

    it("should skip handlers that return undefined", async () => {
      const handler1 = vi.fn(() => undefined);
      const handler2 = vi.fn(() => ({ retry: {} }));

      handler.register(handler1).register(handler2);

      const result = await handler.handle(new Error("test"));

      expect(result).toEqual({ retry: {} });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should handle async handlers", async () => {
      const asyncHandler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { retry: { delay: 50 } };
      });

      handler.register(asyncHandler);

      const result = await handler.handle(new Error("test"));

      expect(result).toEqual({ retry: { delay: 50 } });
    });

    it("should skip non-matching filters", async () => {
      class CustomError extends Error {}
      const mockHandler = vi.fn(() => ({ retry: {} }));

      handler.register(CustomError, mockHandler);

      const result = await handler.handle(new Error("standard"));

      expect(result).toBeUndefined();
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("should reset non-persistent retry handlers", async () => {
      const retryHandler = ErrorHandler.retry({ maxRetries: 2 });
      const handler = new ErrorHandler(retryHandler);

      await handler.handle(new Error("test"));
      await handler.handle(new Error("test"));
      let result = await handler.handle(new Error("test"));
      expect(result).toBeUndefined();

      handler.reset();

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: undefined } });
    });

    it("should not reset persistent retry handlers", async () => {
      const retryHandler = ErrorHandler.retry({
        maxRetries: 2,
        persistent: true,
      });
      const handler = new ErrorHandler(retryHandler);

      await handler.handle(new Error("test"));
      await handler.handle(new Error("test"));
      let result = await handler.handle(new Error("test"));
      expect(result).toBeUndefined();

      handler.reset();

      result = await handler.handle(new Error("test"));
      expect(result).toBeUndefined();
    });

    it("should not affect regular handlers", async () => {
      const mockHandler = vi.fn(() => ({ retry: {} }));
      const handler = new ErrorHandler(mockHandler);

      await handler.handle(new Error("test"));
      handler.reset();
      await handler.handle(new Error("test"));

      expect(mockHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe("ErrorHandler.retry", () => {
    it("should create retry handler with default options", async () => {
      const retryHandler = ErrorHandler.retry({ maxRetries: 3 });
      const handler = new ErrorHandler(retryHandler);

      const result = await handler.handle(new Error("test"));

      expect(result).toEqual({ retry: { delay: undefined } });
    });

    it("should respect maxRetries limit", async () => {
      const retryHandler = ErrorHandler.retry({ maxRetries: 2 });
      const handler = new ErrorHandler(retryHandler);

      let result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: undefined } });

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: undefined } });

      result = await handler.handle(new Error("test"));
      expect(result).toBeUndefined();
    });

    it("should use constant delay when backoff is false", async () => {
      const retryHandler = ErrorHandler.retry({
        maxRetries: 3,
        baseDelay: 100,
      });
      const handler = new ErrorHandler(retryHandler);

      let result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 100 } });

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 100 } });

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 100 } });
    });

    it("should use backoff delay when backoff is true", async () => {
      const retryHandler = ErrorHandler.retry({
        maxRetries: 4,
        baseDelay: 100,
        backoff: true,
      });
      const handler = new ErrorHandler(retryHandler);

      let result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 100 } });

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 200 } });

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 400 } });

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 800 } });
    });

    it("should return undefined delay when baseDelay is 0", async () => {
      const retryHandler = ErrorHandler.retry({ maxRetries: 2, baseDelay: 0 });
      const handler = new ErrorHandler(retryHandler);

      const result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: undefined } });
    });

    it("should return undefined delay when baseDelay is negative", async () => {
      const retryHandler = ErrorHandler.retry({ maxRetries: 2, baseDelay: -1 });
      const handler = new ErrorHandler(retryHandler);

      const result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: undefined } });
    });
  });

  describe("ErrorHandler.retryWithBackoff", () => {
    it("should create retry handler with backoff enabled", async () => {
      const retryHandler = ErrorHandler.retryWithBackoff({
        maxRetries: 3,
        baseDelay: 100,
      });
      const handler = new ErrorHandler(retryHandler);

      let result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 100 } });

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 200 } });

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 400 } });
    });

    it("should respect maxRetries limit", async () => {
      const retryHandler = ErrorHandler.retryWithBackoff({
        maxRetries: 2,
        baseDelay: 50,
      });
      const handler = new ErrorHandler(retryHandler);

      let result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 50 } });

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 100 } });

      result = await handler.handle(new Error("test"));
      expect(result).toBeUndefined();
    });

    it("should support persistent option", async () => {
      const retryHandler = ErrorHandler.retryWithBackoff({
        maxRetries: 2,
        baseDelay: 100,
        persistent: true,
      });
      const handler = new ErrorHandler(retryHandler);

      await handler.handle(new Error("test"));
      await handler.handle(new Error("test"));
      let result = await handler.handle(new Error("test"));
      expect(result).toBeUndefined();

      handler.reset();

      result = await handler.handle(new Error("test"));
      expect(result).toBeUndefined();
    });

    it("should reset non-persistent handlers", async () => {
      const retryHandler = ErrorHandler.retryWithBackoff({
        maxRetries: 2,
        baseDelay: 100,
      });
      const handler = new ErrorHandler(retryHandler);

      await handler.handle(new Error("test"));
      await handler.handle(new Error("test"));
      let result = await handler.handle(new Error("test"));
      expect(result).toBeUndefined();

      handler.reset();

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 100 } });
    });

    it("should use exponential backoff", async () => {
      const retryHandler = ErrorHandler.retryWithBackoff({
        maxRetries: 5,
        baseDelay: 10,
      });
      const handler = new ErrorHandler(retryHandler);

      const results: HandlerResult[] = [];
      for (let i = 0; i < 5; i++) {
        const result = await handler.handle(new Error("test"));
        assert(result);
        results.push(result);
      }

      expect(results).toEqual([
        { retry: { delay: 10 } },
        { retry: { delay: 20 } },
        { retry: { delay: 40 } },
        { retry: { delay: 80 } },
        { retry: { delay: 160 } },
      ]);
    });
  });

  describe("integration tests", () => {
    it("should handle multiple handlers with different filters", async () => {
      class NetworkError extends Error {}
      class ValidationError extends Error {}

      const networkHandler = vi.fn(() => ({ retry: { delay: 1000 } }));
      const validationHandler = vi.fn(() => ({ retry: {} }));
      const defaultHandler = vi.fn(() => ({ retry: { delay: 500 } }));

      const handler = new ErrorHandler()
        .register(NetworkError, networkHandler)
        .register(ValidationError, validationHandler)
        .register(defaultHandler);

      let result = await handler.handle(new NetworkError("network"));
      expect(result).toEqual({ retry: { delay: 1000 } });
      expect(networkHandler).toHaveBeenCalledTimes(1);

      result = await handler.handle(new ValidationError("validation"));
      expect(result).toEqual({ retry: {} });
      expect(validationHandler).toHaveBeenCalledTimes(1);

      result = await handler.handle(new Error("other"));
      expect(result).toEqual({ retry: { delay: 500 } });
      expect(defaultHandler).toHaveBeenCalledTimes(1);
    });

    it("should combine retry handlers with custom handlers", async () => {
      const retryHandler = ErrorHandler.retry({
        maxRetries: 2,
        baseDelay: 100,
      });
      const customHandler = vi.fn(() => ({ retry: { delay: 500 } }));

      const handler = new ErrorHandler()
        .register(retryHandler)
        .register(customHandler);

      let result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 100 } });
      expect(customHandler).not.toHaveBeenCalled();

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 100 } });
      expect(customHandler).not.toHaveBeenCalled();

      result = await handler.handle(new Error("test"));
      expect(result).toEqual({ retry: { delay: 500 } });
      expect(customHandler).toHaveBeenCalledTimes(1);
    });
  });
});
