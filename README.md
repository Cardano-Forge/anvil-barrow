# Barrow [![Version](https://img.shields.io/npm/v/@ada-anvil/barrow?colorB=blue)](https://www.npmjs.com/package/@ada-anvil/barrow)

Barrow is a framework for building event processing tools. It provides a `Controller` class that manages any event-producing service through a simple `Runner` interface.

## Installation

```bash
npm i @ada-anvil/barrow
```

## Architecture

Barrow is built around two core abstractions:

- **Controller**: Manages the lifecycle of event processing (start, pause, resume, error handling, throttling, filtering)
- **Runner**: Produces events via an async generator. Any service that implements the `Runner` interface can be controlled

```
┌─────────────────────────────────────┐
│            Controller               │
│  ┌─────────────────────────────┐    │
│  │  lifecycle management       │    │
│  │  error handling / retry     │◄──►│  Runner (any implementation)
│  │  filtering / throttling     │    │  ┌───────────────────┐
│  │  tracing / logging          │    │  │ run() → events    │
│  └─────────────────────────────┘    │  │ resume() → events │
└─────────────────────────────────────┘  └───────────────────┘
```

## Usage

### Controller

The `Controller` class is the main entry point for defining and running event processing jobs.

**Constructor:**

```typescript
new Controller<TRunner>(config, startOpts?)
```

**Parameters:**

1. `config` (required): Configuration object with the following properties:
   - `runner`: An instance implementing the `Runner` interface
   - `errorHandler` (optional): An instance of `ErrorHandler` that handles errors during event processing
   - `logger` (optional): A function that handles log events
   - `tracing` (optional): An instance of `ControllerTracer` for metrics and tracing

2. `startOpts` (optional): Default options to use for all `start()` calls. These will be merged with options passed to `start()`, with `start()` options taking precedence. See [Job Configuration](#job-configuration) for available options.

#### Runner Interface

Any class can be a runner by implementing this interface:

```typescript
interface Runner<Def extends RunnerDef> {
  run(opts: Def["opts"]): AsyncGenerator<Def["event"], void>;
  resume(meta: Def["meta"]): AsyncGenerator<Def["event"], void>;
  createMeta(opts: Def["opts"]): Def["meta"];
  createCounters(opts: Def["opts"]): Counters<Def["event"]>;
  onEventProcessed?(event: Def["event"], mut: { meta: Def["meta"] }): void;
}
```

Where `RunnerDef` defines the types for your runner:

```typescript
interface RunnerDef<TMeta, TOpts, TEvent> {
  meta: TMeta;
  opts: TOpts;
  event: TEvent;
}
```

### Available Runners

#### OgmiosIndexer (Chain Synchronization)

Syncs blocks from the Cardano blockchain using Ogmios. Extends `IndexerRunner` which provides common indexer functionality.

```typescript
import { OgmiosIndexer } from "@ada-anvil/barrow/ogmios";

const runner = new OgmiosIndexer({
  connection: { host: "localhost", port: 1337, tls: false },
  beforeRun: async (ctx) => { /* optional setup before the generator starts */ },
  afterRun: async (ctx) => { /* optional cleanup after the generator returns */ },
});
```

Events: `{ type: "apply", block, tip }` | `{ type: "reset", point, tip }`

The internal generator and client creation are exposed as standalone exported functions (`createIndexerGenerator`, `createIndexerClient`) and can be overridden by passing a custom `createGenerator` to `run()`.

#### OgmiosMempool (Mempool Monitoring)

Monitors the Cardano mempool for pending transactions. Generic over the parsed transaction type (`TParsedTx`, defaults to `Schema.Transaction`).

```typescript
import { OgmiosMempool, getIdentityTxParser } from "@ada-anvil/barrow/ogmios";

const runner = new OgmiosMempool({
  connection: { host: "localhost", port: 1337, tls: false },
  parser: getIdentityTxParser(),
  beforeRun: async (ctx) => { /* optional setup before the generator starts */ },
  afterRun: async (ctx) => { /* optional cleanup after the generator returns */ },
  getExistingTxs: async (ctx) => [], // optional: seed known txs to detect drops
});
```

Events: `{ type: "txs", added: TParsedTx[], dropped: TParsedTx[] }`

Supply a custom `parser` to transform raw `Schema.Transaction` objects into your domain type:

```typescript
type MyTx = { hash: string; fee: bigint };

const runner = new OgmiosMempool<MyTx>({
  connection: { host: "localhost", port: 1337, tls: false },
  parser: {
    parseTx: (tx) => ({ hash: tx.id, fee: tx.fee.ada.lovelace }),
    getTxHash: (tx) => tx.hash,
  },
});
```

The internal generator and client creation are exposed as standalone exported functions (`createMempoolGenerator`, `createMempoolClient`) and can be overridden by passing a custom `createGenerator` to `run()`.

### Getting Started

#### Step 1: Install Dependencies

```bash
npm i @cardano-ogmios/client
```

#### Step 2: Create a Runner

For chain indexing:

```typescript
import { OgmiosIndexer, type IndexerRunnerDef, type OgmiosSchema } from "@ada-anvil/barrow/ogmios";

const runner = new OgmiosIndexer({
  connection: { host: "localhost", port: 1337, tls: false },
});
```

For mempool monitoring:

```typescript
import { OgmiosMempool, getIdentityTxParser, type MempoolRunnerDef } from "@ada-anvil/barrow/ogmios";

const runner = new OgmiosMempool({
  connection: { host: "localhost", port: 1337, tls: false },
  parser: getIdentityTxParser(),
});
```

#### Step 3: Create a Controller

```typescript
import { Controller, ErrorHandler } from "@ada-anvil/barrow";

const controller = new Controller<IndexerRunnerDef<OgmiosSchema>>({
  runner,
  errorHandler: new ErrorHandler(),
});
```

You can optionally provide default start options as a second parameter:

```typescript
const controller = new Controller<IndexerRunnerDef<OgmiosSchema>>(
  {
    runner,
    errorHandler: new ErrorHandler(),
  },
  {
    throttle: [100, "milliseconds"],
    fn: (event) => {
      console.log(event);
    },
  },
);
```

#### Step 4: Start Processing

```typescript
await controller.start({
  fn: (event) => {
    console.log(event);
  },
  point: {
    slot: 101163751,
    id: "fa5a6a51632b90557665fcb33970f4fb372dff6ad0191e083ff3b6b221f2b87e",
  },
  throttle: [100, "milliseconds"],
});

// Wait for completion
await controller.waitForCompletion();
```

#### Controlling Jobs

**Pause and Resume:**

```typescript
await controller.pause();
await controller.resume();
```

**Restart:**

Calling `start()` on a paused job resets the state and starts from scratch.

#### Job Completion

A job can complete in two ways:

1. **Using `takeUntil`**: The function returns `true`

   ```typescript
   await controller.start({
     fn: (event) => { /* process event */ },
     point: startPoint,
     takeUntil: ({ state }) => state.meta.syncTip?.slot >= targetSlot,
   });
   ```

2. **Using handler return value**: The `fn` handler returns `{ done: true }`
   ```typescript
   await controller.start({
     fn: (event) => {
       if (someCondition) {
         return { done: true };
       }
     },
     point: startPoint,
   });
   ```

#### Throttling and Filtering

Throttle and filter apply to ALL events, including filtered ones:

```typescript
await controller.start({
  fn: (event) => { /* process event */ },
  filter: (event) => event.type === "apply",
  point: startPoint,
  throttle: [100, "milliseconds"],
});
```

### Job Configuration

Configuration properties:

- `fn` (optional): Function that handles events
- `throttle` (optional): Delay between events `[value, unit]`
- `filter` (optional): Function to filter events (returns boolean)
- `takeUntil` (optional): Function that returns true to stop processing

Runners may have additional required options (e.g., `point` for indexers).

### Data Structures

Event shapes depend on the runner. Built-in runners emit:

**OgmiosIndexer events:**

- `apply`: `{ type: "apply", block, tip }`
- `reset`: `{ type: "reset", point, tip }`

**OgmiosMempool events:**

- `txs`: `{ type: "txs", added: TParsedTx[], dropped: TParsedTx[] }`

**Point (IndexerRunner):**

- `slot`: Slot number
- `id`: Block hash

## ErrorHandler

`ErrorHandler` defines how errors are handled during event processing. Pass an instance to `Controller` via the `errorHandler` config option.

```typescript
import { Controller, ErrorHandler } from "@ada-anvil/barrow";

const errorHandler = new ErrorHandler(
  ErrorHandler.retry({ maxRetries: 3, baseDelay: 1000 }),
);
```

### Registering handlers

Handlers can be registered in the constructor or via `.register()`. Each handler is called in order until one returns a result.

```typescript
errorHandler.register((error) => {
  if (error instanceof MyTransientError) return { retry: { delay: 500 } };
});
```

Filter by error type (constructor) or predicate:

```typescript
errorHandler.register(MyTransientError, ErrorHandler.retry({ maxRetries: 5 }));
errorHandler.register(
  (e) => e instanceof Error && e.message.includes("timeout"),
  ErrorHandler.retryWithBackoff({ maxRetries: 4, baseDelay: 200 }),
);
```

### Built-in policies

`ErrorHandler.retry(opts)` and `ErrorHandler.retryWithBackoff(opts)` return retry policies:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `maxRetries` | `number` | required | Maximum number of retry attempts |
| `baseDelay` | `number` | `0` | Milliseconds between retries |
| `backoff` | `boolean` | `false` | Double the delay on each attempt |
| `persistent` | `boolean` | `false` | Preserve retry count across job restarts |

### Handler result

A handler function should return `{ retry: { delay?: number } }` to trigger a retry, or `undefined`/`void` to pass to the next handler. If no handler returns a result, the error is rethrown.

## EventQueue

`EventQueue` is a bounded async queue with abort signal support. It is used internally by the built-in runners but is also exported for use in custom runners.

```typescript
import { EventQueue } from "@ada-anvil/barrow";

const queue = new EventQueue<MyEvent>({ capacity: 100, signal: abortController.signal });

await queue.push(event);         // blocks when full
const result = await queue.next(); // blocks when empty
// result is the event, or an AbortError if the signal was aborted
```

Configuration:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `capacity` | `number` | `Infinity` | Max queued items before `push` blocks |
| `signal` | `AbortSignal` | none | Signal to abort waiting producers/consumers |

## Logger

Barrow provides built-in logging support using [Pino](https://getpino.io).

### Setup

```bash
npm i pino
```

```typescript
import { pinoLogger } from "@ada-anvil/barrow/pino";
import { pino } from "pino";

const controller = new Controller<IndexerRunnerDef<OgmiosSchema>>({
  runner: new OgmiosIndexer({ connection: { host: "localhost", port: 1337, tls: false } }),
  logger: pinoLogger(pino()),
});
```

## Tracing

Barrow supports [OpenTelemetry](https://opentelemetry.io) for metrics and tracing.

### Setup

```bash
npm i @opentelemetry/api
```

```typescript
import { otelTracingConfig } from "@ada-anvil/barrow/otel";
import { ControllerTracer } from "@ada-anvil/barrow";

const controller = new Controller<MempoolRunnerDef>({
  runner: new OgmiosMempool({
    connection: { host: "localhost", port: 1337, tls: false },
    parser: getIdentityTxParser(),
  }),
  tracing: new ControllerTracer(otelTracingConfig()),
});
```

For indexer-specific metrics (sync tip, chain tip, is_synced, apply/reset counts), use `IndexerControllerTracer`:

```typescript
import { IndexerControllerTracer, indexerMetricDefs } from "@ada-anvil/barrow/indexer";

const tracing = new IndexerControllerTracer(
  otelTracingConfig({ metrics: indexerMetricDefs })
);
```

### Core Metrics

Available on all runners via `ControllerTracer`:

| Metric Key     | Type      | Name             | Description                       | Unit         |
| -------------- | --------- | ---------------- | --------------------------------- | ------------ |
| status         | gauge     | status           | Controller status                 | -            |
| processingTime | histogram | processing_time  | Time to process an event          | milliseconds |
| arrivalTime    | histogram | arrival_time     | Time to receive an event          | milliseconds |
| filterCount    | gauge     | filter_count     | Number of filtered events         | -            |
| errorCount     | gauge     | error_count      | Number of errors                  | -            |

### Indexer-Specific Metrics

Available when using `IndexerControllerTracer`:

| Metric Key     | Type      | Name             | Description                       |
| -------------- | --------- | ---------------- | --------------------------------- |
| syncTipSlot    | gauge     | sync_tip_slot    | Sync tip slot                     |
| syncTipHeight  | gauge     | sync_tip_height  | Sync tip height                   |
| chainTipSlot   | gauge     | chain_tip_slot   | Chain tip slot                    |
| chainTipHeight | gauge     | chain_tip_height | Chain tip height                  |
| isSynced       | gauge     | is_synced        | Is synced (1 = yes, 0 = no)       |
| applyCount     | gauge     | apply_count      | Number of apply events            |
| resetCount     | gauge     | reset_count      | Number of reset events            |

## Examples

Example implementations are available in the `src/examples` directory.

### Running Examples

1. Install dependencies:

   ```bash
   npm i
   ```

2. Create a `.env` file:

   ```dotenv
   OGMIOS_NODE_HOST=<ogmios-node-host>
   OGMIOS_NODE_PORT=<ogmios-node-port>
   OGMIOS_NODE_TLS=<ogmios-node-tls>
   ```

3. Run an example:
   ```bash
   npm run example ogmios-indexer
   npm run example ogmios-mempool
   ```
