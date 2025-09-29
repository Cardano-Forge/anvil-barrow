import { describe, expect, test, vi } from "vitest";
import { deferredPromise } from "./deferred-promise";

describe("deferredPromise", () => {
  test("should resolve with a value", async () => {
    const deferred = deferredPromise<number>();

    vi.useFakeTimers();
    setTimeout(() => deferred.resolve(42), 1000);
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    const result = await deferred.promise;
    expect(result).toBe(42);
  });

  test("should resolve with undefined when type is void", async () => {
    const deferred = deferredPromise();

    vi.useFakeTimers();
    setTimeout(() => deferred.resolve(undefined), 1000);
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    const result = await deferred.promise;
    expect(result).toBeUndefined();
  });

  test("should reject with a reason", async () => {
    const deferred = deferredPromise<number, string>();
    const errorMessage = "Something went wrong";

    vi.useFakeTimers();
    setTimeout(() => deferred.reject(errorMessage), 1000);
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    await expect(deferred.promise).rejects.toBe(errorMessage);
  });

  test("should reject with an Error object", async () => {
    const deferred = deferredPromise<number, Error>();
    const error = new Error("Test error");

    vi.useFakeTimers();
    setTimeout(() => deferred.reject(error), 1000);
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    await expect(deferred.promise).rejects.toThrow("Test error");
  });

  test("should resolve immediately when called synchronously", async () => {
    const deferred = deferredPromise<string>();

    deferred.resolve("immediate");

    const result = await deferred.promise;
    expect(result).toBe("immediate");
  });

  test("should reject immediately when called synchronously", async () => {
    const deferred = deferredPromise<string>();

    deferred.reject("immediate error");

    await expect(deferred.promise).rejects.toBe("immediate error");
  });

  test("should resolve with a PromiseLike value", async () => {
    const deferred = deferredPromise<number>();
    const promiseLike = Promise.resolve(99);

    deferred.resolve(promiseLike);

    const result = await deferred.promise;
    expect(result).toBe(99);
  });

  test("should allow multiple awaits on the same promise", async () => {
    const deferred = deferredPromise<string>();

    deferred.resolve("shared");

    const result1 = await deferred.promise;
    const result2 = await deferred.promise;

    expect(result1).toBe("shared");
    expect(result2).toBe("shared");
  });

  test("should handle complex object types", async () => {
    const user = { id: 1, name: "Alice" };
    const deferred = deferredPromise<typeof user>();

    deferred.resolve(user);

    const result = await deferred.promise;
    expect(result).toBe(user);
  });

  test("should expose resolve and reject functions separately", () => {
    const deferred = deferredPromise<number>();

    expect(typeof deferred.resolve).toBe("function");
    expect(typeof deferred.reject).toBe("function");
    expect(deferred.promise).toBeInstanceOf(Promise);
  });
});
