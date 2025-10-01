import type { MaybePromise } from "./types";

export class ErrorHandler {
  private handlers: RegisteredHandler[] = [];

  constructor(...handlers: (ErrorHandlerFn | RetryPolicyType)[]) {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  register(handler: ErrorHandlerFn | RetryPolicyType): ErrorHandler;
  register(
    filter: ErrorFilter,
    handler: ErrorHandlerFn | RetryPolicyType,
  ): ErrorHandler;
  register(
    filterOrHandler: ErrorFilter | ErrorHandlerFn | RetryPolicyType,
    handler?: ErrorHandlerFn | RetryPolicyType,
  ): ErrorHandler {
    let filter: ErrorFilter | undefined;
    let actualHandler: ErrorHandlerFn | RetryPolicyType;

    if (handler !== undefined) {
      filter = filterOrHandler as ErrorFilter;
      actualHandler = handler;
    } else {
      actualHandler = filterOrHandler as ErrorHandlerFn | RetryPolicyType;
    }

    if (isBuiltinHandler(actualHandler)) {
      const resolved = resolveBuiltinHandler(actualHandler);
      this.handlers.push({
        filter,
        handler: resolved.handler,
        reset: resolved.reset,
        persistent: actualHandler.persistent,
      });
    } else {
      this.handlers.push({
        filter,
        handler: actualHandler,
      });
    }

    return this;
  }

  async handle(error: unknown): Promise<HandlerResult | undefined> {
    for (const { filter, handler } of this.handlers) {
      if (matchesFilter(error, filter)) {
        const result = await handler(error);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return undefined;
  }

  reset(): void {
    for (const registeredHandler of this.handlers) {
      if (registeredHandler.reset && !registeredHandler.persistent) {
        registeredHandler.reset();
      }
    }
  }

  static retry(opts: RetryOptions): RetryPolicyType {
    return {
      type: "retry",
      maxRetries: opts.maxRetries,
      baseDelay: opts.baseDelay ?? 0,
      backoff: opts.backoff ?? false,
      persistent: opts.persistent ?? false,
    };
  }

  static retryWithBackoff(
    opts: Omit<RetryOptions, "backoff" | "baseDelay"> & { baseDelay: number },
  ): RetryPolicyType {
    return {
      type: "retry",
      maxRetries: opts.maxRetries,
      baseDelay: opts.baseDelay,
      backoff: true,
      persistent: opts.persistent ?? false,
    };
  }
}

function matchesFilter(error: unknown, filter?: ErrorFilter): boolean {
  if (!filter) {
    return true;
  }

  if (typeof filter === "function" && filter.prototype) {
    return error instanceof filter;
  }

  return (filter as (error: unknown) => boolean)(error);
}

function isBuiltinHandler(
  handler: ErrorHandlerFn | RetryPolicyType,
): handler is RetryPolicyType {
  return typeof handler === "object" && handler !== null && "type" in handler;
}

function resolveBuiltinHandler(
  config: RetryPolicyType,
): Pick<RegisteredHandler, "handler" | "reset"> {
  switch (config.type) {
    case "retry": {
      return resolveRetryHandler(config);
    }
    default: {
      throw new Error(`Unknown builtin handler type: ${config.type}`);
    }
  }
}

function resolveRetryHandler(opts: {
  maxRetries: number;
  baseDelay?: number;
  backoff?: boolean;
}): { handler: ErrorHandlerFn; reset: () => void } {
  const { maxRetries, baseDelay = 0, backoff = false } = opts;
  let attempts = 0;

  const handler = (_error: unknown): HandlerResult | undefined => {
    if (attempts >= maxRetries) {
      return undefined;
    }

    attempts += 1;

    let delay: number | undefined;
    if (baseDelay <= 0) {
      delay = undefined;
    } else if (backoff) {
      delay = baseDelay * 2 ** (attempts - 1);
    } else {
      delay = baseDelay;
    }

    return { retry: { delay } };
  };

  const reset = () => {
    attempts = 0;
  };

  return { handler, reset };
}

export type ErrorFilter =
  | ((error: unknown) => boolean)
  | (new (
      // biome-ignore lint/suspicious/noExplicitAny: Error constructors need flexible parameters
      ...args: any[]
    ) => Error);

export type HandlerResult = {
  retry?: { delay?: number };
};

export type ErrorHandlerFn = (
  error: unknown,
  // biome-ignore lint/suspicious/noConfusingVoidType: Allow void for better DX
) => MaybePromise<HandlerResult | undefined | void>;

export type RetryOptions = {
  /** Maximum number of retries (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds between retries (default: 1000) */
  baseDelay?: number;
  /** Use exponential backoff (default: false) */
  backoff?: boolean;
  /** Preserve error handler state between retries (default: false) */
  persistent?: boolean;
};

export type RetryPolicyType = {
  type: "retry";
} & RetryOptions;

export type ErrorHandlerConfig = {
  filter?: ErrorFilter;
  handler: ErrorHandlerFn | RetryPolicyType;
};

type RegisteredHandler = {
  filter?: ErrorFilter;
  handler: ErrorHandlerFn;
  reset?: () => void;
  persistent?: boolean;
};
