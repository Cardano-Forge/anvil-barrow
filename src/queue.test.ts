import { describe, expect, it } from "vitest";
import { AbortError } from "./errors";
import { EventQueue } from "./queue";

describe("EventQueue", () => {
  it("returns items in FIFO order", async () => {
    const queue = new EventQueue<number>();
    await queue.push(1);
    await queue.push(2);
    await queue.push(3);

    expect(await queue.next()).toBe(1);
    expect(await queue.next()).toBe(2);
    expect(await queue.next()).toBe(3);
  });

  it("next() waits until an item is pushed", async () => {
    const queue = new EventQueue<string>();
    const order: string[] = [];

    const consumer = queue.next().then((v) => order.push(`consumed:${v}`));

    await Promise.resolve();
    order.push("pushing");
    await queue.push("hello");

    await consumer;
    expect(order).toEqual(["pushing", "consumed:hello"]);
  });

  it("push() waits when queue is at capacity", async () => {
    const queue = new EventQueue<number>({ capacity: 1 });
    const order: string[] = [];

    await queue.push(1);

    const producer = queue.push(2).then(() => order.push("pushed:2"));

    await Promise.resolve();
    order.push("consuming");
    await queue.next();

    await producer;
    expect(order).toEqual(["consuming", "pushed:2"]);
  });

  it("next() returns AbortError when signal is aborted", async () => {
    const queue = new EventQueue<number>();
    const controller = new AbortController();

    const promise = queue.next({ signal: controller.signal });
    controller.abort();

    expect(await promise).toBeInstanceOf(AbortError);
  });

  it("push() returns AbortError when signal is aborted at capacity", async () => {
    const queue = new EventQueue<number>({ capacity: 1 });
    const controller = new AbortController();

    await queue.push(1);
    const promise = queue.push(2, { signal: controller.signal });
    controller.abort();

    expect(await promise).toBeInstanceOf(AbortError);
  });

  it("next() returns AbortError when config signal is aborted", async () => {
    const controller = new AbortController();
    const queue = new EventQueue<number>({ signal: controller.signal });

    const promise = queue.next();
    controller.abort();

    expect(await promise).toBeInstanceOf(AbortError);
  });
});
