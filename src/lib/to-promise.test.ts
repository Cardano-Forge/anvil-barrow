import { describe, expect, test } from "vitest";
import { toPromise } from "./to-promise";

describe("toPromise", () => {
  test("should return the same promise when given a Promise", async () => {
    const promise = Promise.resolve(42);
    const result = toPromise(promise);

    expect(result).toBe(promise);
    expect(await result).toBe(42);
  });

  test("should wrap a non-promise value in a resolved promise", async () => {
    const result = toPromise(42);

    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe(42);
  });

  test("should handle string values", async () => {
    const result = toPromise("hello");

    expect(await result).toBe("hello");
  });

  test("should handle null values", async () => {
    const result = toPromise(null);

    expect(await result).toBeNull();
  });

  test("should handle undefined values", async () => {
    const result = toPromise(undefined);

    expect(await result).toBeUndefined();
  });

  test("should handle boolean values", async () => {
    const resultTrue = toPromise(true);
    const resultFalse = toPromise(false);

    expect(await resultTrue).toBe(true);
    expect(await resultFalse).toBe(false);
  });

  test("should handle object values", async () => {
    const obj = { id: 1, name: "Alice" };
    const result = toPromise(obj);

    expect(await result).toEqual(obj);
  });

  test("should handle array values", async () => {
    const arr = [1, 2, 3];
    const result = toPromise(arr);

    expect(await result).toEqual(arr);
  });

  test("should preserve rejected promises", async () => {
    const promise = Promise.reject(new Error("Test error"));
    const result = toPromise(promise);

    expect(result).toBe(promise);
    await expect(result).rejects.toThrow("Test error");
  });

  test("should handle Error instances as values", async () => {
    const error = new Error("Not rejected, just a value");
    const result = toPromise(error);

    expect(await result).toBe(error);
  });
});
