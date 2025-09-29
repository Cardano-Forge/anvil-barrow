export class ErrorHandler {
  private handlers: RegisteredHandler[] = [];

  constructor(...handlers: (ErrorHandlerFn | BuiltinHandlerType)[]) {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  register(handler: ErrorHandlerFn | BuiltinHandlerType): ErrorHandler;
  register(
    filter: ErrorFilter,
    handler: ErrorHandlerFn | BuiltinHandlerType,
  ): ErrorHandler;
  register(
    filterOrHandler: ErrorFilter | ErrorHandlerFn | BuiltinHandlerType,
    handler?: ErrorHandlerFn | BuiltinHandlerType,
  ): ErrorHandler {
    let filter: ErrorFilter | undefined;
    let actualHandler: ErrorHandlerFn | BuiltinHandlerType;

    if (handler !== undefined) {
      filter = filterOrHandler as ErrorFilter;
      actualHandler = handler;
    } else {
      actualHandler = filterOrHandler as ErrorHandlerFn | BuiltinHandlerType;
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
        const result = await Promise.resolve(handler(error));
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

  static retry(opts: RetryOptions): BuiltinHandlerType {
    return {
      type: "retry",
      maxRetries: opts.maxRetries,
      baseDelay: opts.baseDelay ?? 0,
      exponential: opts.exponential ?? false,
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
  handler: ErrorHandlerFn | BuiltinHandlerType,
): handler is BuiltinHandlerType {
  return typeof handler === "object" && handler !== null && "type" in handler;
}

function resolveBuiltinHandler(
  config: BuiltinHandlerType,
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
  exponential?: boolean;
}): { handler: ErrorHandlerFn; reset: () => void } {
  const { maxRetries, baseDelay = 0, exponential = false } = opts;
  let attempts = 0;

  const handler = (_error: unknown): HandlerResult | undefined => {
    if (attempts >= maxRetries) {
      return undefined;
    }

    attempts += 1;

    let delay: number | undefined;
    if (baseDelay <= 0) {
      delay = undefined;
    } else if (exponential) {
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
) => HandlerResult | undefined | void;

export type RetryOptions = {
  maxRetries: number;
  baseDelay?: number;
  exponential?: boolean;
  persistent?: boolean;
};

export type BuiltinHandlerType = {
  type: "retry";
} & RetryOptions;

export type ErrorHandlerConfig = {
  filter?: ErrorFilter;
  handler: ErrorHandlerFn | BuiltinHandlerType;
};

type RegisteredHandler = {
  filter?: ErrorFilter;
  handler: ErrorHandlerFn;
  reset?: () => void;
  persistent?: boolean;
};
