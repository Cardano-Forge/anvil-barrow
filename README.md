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
  host: "localhost",
  port: 1337,
  tls: false,
});
```

Events: `{ type: "apply", block, tip }` | `{ type: "reset", point, tip }`

#### OgmiosMempool (Mempool Monitoring)

Monitors the Cardano mempool for pending transactions.

```typescript
import { OgmiosMempool } from "@ada-anvil/barrow/ogmios";

const runner = new OgmiosMempool({
  host: "localhost",
  port: 1337,
  tls: false,
});
```

Events: `{ type: "txs", txs: string[] }`

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
  host: "localhost",
  port: 1337,
  tls: false,
});
```

For mempool monitoring:

```typescript
import { OgmiosMempool, type MempoolRunnerDef } from "@ada-anvil/barrow/ogmios";

const runner = new OgmiosMempool({
  host: "localhost",
  port: 1337,
  tls: false,
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

- `txs`: `{ type: "txs", txs: string[] }`

**Point (IndexerRunner):**

- `slot`: Slot number
- `id`: Block hash

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
  runner: new OgmiosIndexer({ host: "localhost", port: 1337, tls: false }),
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
  runner: new OgmiosMempool({ host: "localhost", port: 1337, tls: false }),
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
