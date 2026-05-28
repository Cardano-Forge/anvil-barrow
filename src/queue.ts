import type { Result } from "trynot";
import { AbortError } from "./errors";

export class EventQueue<TEvent> {
  private _events: TEvent[] = [];
  private _producers: WaitList = [];
  private _consumers: WaitList = [];
  private _config: EventQueueConfig;

  constructor(config?: Partial<EventQueueConfig>) {
    this._config = {
      ...defaultConfig,
      ...config,
    };
  }

  async push(
    event: TEvent,
    opts?: { signal?: AbortSignal },
  ): Promise<Result<void, AbortError>> {
    while (this._events.length >= this._config.capacity) {
      const result = await this._wait(this._producers, opts);
      if (result) return result;
    }
    this._events.push(event);
    this._consumers.shift()?.();
  }

  async next(opts?: {
    signal?: AbortSignal;
  }): Promise<Result<TEvent, AbortError>> {
    while (this._events.length === 0) {
      const result = await this._wait(this._consumers, opts);
      if (result) return result;
    }
    const event = this._events.shift() as TEvent;
    this._producers.shift()?.();
    return event;
  }

  private _wait(
    waitList: WaitList,
    opts?: { signal?: AbortSignal },
  ): Promise<Result<void, AbortError>> {
    return new Promise<Result<void, AbortError>>((resolve) => {
      const signal = opts?.signal ?? this._config.signal;
      if (!signal) {
        waitList.push(resolve);
        return;
      }

      const onAbort = () => {
        const index = waitList.indexOf(resolveAndCleanup);
        if (index !== -1) waitList.splice(index, 1);
        resolve(new AbortError(signal.reason));
      };

      const resolveAndCleanup = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };

      waitList.push(resolveAndCleanup);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export type EventQueueConfig = {
  signal?: AbortSignal;
  capacity: number;
};

const defaultConfig: EventQueueConfig = {
  capacity: Number.POSITIVE_INFINITY,
};

type WaitList = (() => void)[];
