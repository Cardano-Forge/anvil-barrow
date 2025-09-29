import type { MaybePromise } from "../types";

export function toPromise<T>(
  maybePromise: MaybePromise<T>,
): Promise<T | Error> {
  if (maybePromise instanceof Promise) {
    return maybePromise;
  }
  return Promise.resolve(maybePromise);
}
