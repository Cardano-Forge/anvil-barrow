import { describe, expect, test } from "vitest";
import { entries } from "./entries";

describe("entries", () => {
  test("should return entries from a simple object", () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = entries(obj);

    expect(result).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  test("should handle objects with string values", () => {
    const obj = { name: "Alice", role: "Developer" };
    const result = entries(obj);

    expect(result).toEqual([
      ["name", "Alice"],
      ["role", "Developer"],
    ]);
  });

  test("should handle objects with mixed value types", () => {
    const obj = { id: 1, name: "Bob", active: true, score: 99.5 };
    const result = entries(obj);

    expect(result).toEqual([
      ["id", 1],
      ["name", "Bob"],
      ["active", true],
      ["score", 99.5],
    ]);
  });

  test("should handle empty objects", () => {
    const obj = {};
    const result = entries(obj);

    expect(result).toEqual([]);
  });

  test("should handle objects with null values", () => {
    const obj = { a: null, b: undefined };
    const result = entries(obj);

    expect(result).toEqual([
      ["a", null],
      ["b", undefined],
    ]);
  });

  test("should handle objects with nested objects as values", () => {
    const obj = { user: { id: 1 }, settings: { theme: "dark" } };
    const result = entries(obj);

    expect(result).toEqual([
      ["user", { id: 1 }],
      ["settings", { theme: "dark" }],
    ]);
  });

  test("should handle objects with array values", () => {
    const obj = { tags: ["a", "b"], ids: [1, 2, 3] };
    const result = entries(obj);

    expect(result).toEqual([
      ["tags", ["a", "b"]],
      ["ids", [1, 2, 3]],
    ]);
  });

  test("should only return own enumerable properties", () => {
    const obj = Object.create({ inherited: "value" });
    obj.own = "ownValue";

    const result = entries(obj);

    expect(result).toEqual([["own", "ownValue"]]);
  });
});
