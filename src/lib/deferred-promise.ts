import { identity } from "./identity";

export type DeferredPromise<T, R = unknown> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: R): void;
};

export function deferredPromise<T = void, R = unknown>(): DeferredPromise<
  T,
  R
> {
  let resolve: (value: T | PromiseLike<T>) => void = identity;
  let reject: (reason?: R) => void = identity;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
