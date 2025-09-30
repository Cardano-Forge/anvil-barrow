# Barrow

Barrow is a framework for building blockchain indexing tools. It provides a simple API for defining and running indexing jobs on the Cardano blockchain.

## Installation

To use Barrow, you must first configure your npm client to use the GitHub Package Registry.

Create a `.npmrc` file in your project root and add the following line:

```
@cardano-forge:registry=https://npm.pkg.github.com
```

Then, install Barrow using npm:

```bash
npm i @cardano-forge/barrow
```

## Usage

### Controller

The `Controller` class is the main entry point for defining and running indexing jobs.

It takes a configuration object as its only argument, which includes the following properties:

- `syncClient`: An instance of `SyncClient` that provides a generator for sync events.
- `errorHandler` (optional): An instance of `ErrorHandler` that handles errors during sync events.
- `logger` (optional): A function that handles log events.
- `tracingConfig` (optional): An object that configures tracing for the controller.

#### SyncClient

The `SyncClient` interface defines a method for generating sync events.

Currently, the only implementation of `SyncClient` is `OgmiosSyncClient`, which uses the [Ogmios API](https://ogmios.dev/mini-protocols/local-chain-sync/) to sync with the blockchain.

Future support is planned for other sync clients such as [Dolos](https://docs.txpipe.io/).

#### ErrorHandler

The `ErrorHandler` class is responsible for handling errors during sync events.

**Methods:**

- `register(filter, handler)`: Registers an error handler or retry policy for a specific error type or class.
- `handle(error)`: Processes an error and returns the handling result.
- `reset()`: Resets the error handler to its initial state.

##### Retry policies

Built-in retry handlers:

- `ErrorHandler.retry(options)`: Retries the sync event after a specified delay.
- `ErrorHandler.retryWithBackoff(options)`: Retries the sync event with exponential backoff.

##### Error filters

A filter can be:

- An Error class (only instances of that class will be handled)
- A function that takes an error and returns a boolean indicating whether to handle it

##### Retry options

Options for `ErrorHandler.retry` and `ErrorHandler.retryWithBackoff`:

- `maxRetries` (optional): Maximum number of retries (default: 3)
- `baseDelay` (optional): Base delay in milliseconds between retries (default: 1000)
- `backoff` (optional): Use exponential backoff (default: false)
- `persistent` (optional): Preserve error handler state between retries (default: false)

### Getting Started

#### Step 1: Install Dependencies

Install the Ogmios client:

```bash
npm i @cardano-ogmios/client
```

#### Step 2: Create a Sync Client

Create an instance of `OgmiosSyncClient`:

```typescript
import { OgmiosSyncClient } from "@cardano-forge/barrow/ogmios";

const syncClient = new OgmiosSyncClient({
  host: "localhost",
  port: 1337,
  tls: false,
});
```

Configuration options:
- `host`: Ogmios node hostname
- `port`: Ogmios node port
- `tls`: Enable TLS connection

#### Step 3: Create a Controller

Create a `Controller` instance with your sync client:

```typescript
import { Controller, ErrorHandler } from "@cardano-forge/barrow";

const controller = new Controller({
  syncClient,
  errorHandler: new ErrorHandler(),
});
```

#### Step 4: Start Syncing

Start the controller with a sync job configuration:

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

// Wait for sync completion
await controller.waitForCompletion();
```

#### Controlling Sync Jobs

**Pause and Resume:**

```typescript
await controller.pause();  // Preserves state
await controller.resume(); // Resumes from paused point
```

**Restart:**

Calling `start()` on a paused job resets the state and starts from scratch.

#### Job Completion

A sync job can complete in two ways:

1. **Using `takeUntil`**: The `takeUntil` function returns `true`
   ```typescript
   await controller.start({
     fn: (event) => { /* process event */ },
     point: startPoint,
     takeUntil: (state) => state.tip.slot >= targetSlot,
   });
   ```

2. **Using handler return value**: The `fn` handler returns `{ done: true }`
   ```typescript
   await controller.start({
     fn: (event) => {
       // Process event
       if (someCondition) {
         return { done: true };
       }
     },
     point: startPoint,
   });
   ```

### Sync Job Configuration

Configuration properties:

- `fn`: Function that handles sync events
- `point`: Starting point for syncing (slot and block ID)
- `throttle` (optional): Throttle duration for sync events
- `filter` (optional): Function to filter sync events
- `takeUntil` (optional): Function that returns true to stop syncing

#### Data Structures

**Sync Event:**
- `type`: Event type
- `block`: Block that was synced
- `tip`: Current chain tip

**Point:**
- `slot`: Slot number
- `id`: Block hash

**Tip:**
- `slot`: Slot number
- `id`: Block hash
- `height`: Block height

**Block:**
- `type`: Block type
- `era`: Cardano era
- `id`: Block hash
- `height`: Block height
- `slot` (optional): Slot number

## Logger

Barrow provides built-in logging support using [Pino](https://getpino.io).

### Setup

Install Pino:

```bash
npm i pino
```

Configure the logger:

```typescript
import { pinoLogger } from "@cardano-forge/barrow/pino";
import { pino } from "pino";

const controller = new Controller({
  syncClient: new OgmiosSyncClient({
    host: "localhost",
    port: 1337,
    tls: false,
  }),
  logger: pinoLogger(pino()),
});
```

## Tracing

Barrow supports [OpenTelemetry](https://opentelemetry.io) for metrics and tracing.

### Setup

Install OpenTelemetry:

```bash
npm i @opentelemetry/api
```

Configure tracing:

```typescript
import { otelTracingConfig } from "@cardano-forge/barrow/otel";

const controller = new Controller({
  syncClient: new OgmiosSyncClient({
    host: "localhost",
    port: 1337,
    tls: false,
  }),
  tracingConfig: otelTracingConfig(),
});
```

The `otelTracingConfig` function accepts either:
- A `Meter` instance
- A configuration object with `name`, `version` (optional), and `opts` (optional)

### Available Metrics

- `status`: Controller status
- `sync_tip_slot`: Current sync slot number
- `sync_tip_height`: Current sync block height
- `chain_tip_slot`: Chain tip slot number
- `chain_tip_height`: Chain tip block height
- `is_synced`: Sync status (boolean)
- `processing_time`: Event processing duration
- `arrival_time`: Event arrival time
- `apply_count`: Number of apply events
- `reset_count`: Number of reset events
- `filter_count`: Number of filtered events
- `error_count`: Number of errors

## Examples

Example implementations are available in the `src/examples` directory.

### Running Examples

1. Install dependencies:
   ```bash
   npm i
   ```

2. Create a `.env` file in the project root:
   ```dotenv
   OGMIOS_NODE_HOST=<ogmios-node-host>
   OGMIOS_NODE_PORT=<ogmios-node-port>
   OGMIOS_NODE_TLS=<ogmios-node-tls>
   ```

3. Run an example:
   ```bash
   npm run example kitchen-sink
   ```
