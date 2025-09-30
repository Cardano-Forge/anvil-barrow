# Anvil Barrow

Barrow is a framework for building chain indexing tools. It provides a simple API for defining and running indexing jobs.

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

# Usage

## Controller

The `Controller` class is the main entry point for defining and running indexing jobs.

It takes a configuration object as its only argument, which includes the following properties:

- `syncClient`: An instance of `SyncClient` that provides a generator for sync events.
- `errorHandler` (optional): An instance of `ErrorHandler` that handles errors during sync events.
- `logger` (optional): A function that handles log events.
- `tracingConfig` (optional): An object that configures tracing for the controller.

### SyncClient

The `SyncClient` interface defines a method for generating sync events.

Currently, the only implementation of `SyncClient` is `OgmiosSyncClient`, which uses the [Ogmios API](https://ogmios.dev/mini-protocols/local-chain-sync/) to sync events.

In the future, we plan to add support for other sync clients such as [Dolos](https://docs.txpipe.io/).

### ErrorHandler

The `ErrorHandler` class is responsible for handling errors during sync events.

It takes a list of error handlers as its constructor argument, which can be either a single handler or an array of handlers.

Each error handler is a function that takes an error as its argument and returns an object that represents the result of handling the error.

The `ErrorHandler` class provides the following methods for registering and handling errors:

- `register(filter, handler)`: Registers an error handler (or retry policy) for a specific error type or class.
- `handle(error)`: Handles an error and returns a result.
- `reset()`: Resets the error handler to its initial state.

#### Retry policies

An error handler is a function that takes an error as its argument and returns an object that represents the result of handling the error.

The `ErrorHandler` class provides the following built-in error handlers:

- `ErrorHandler.retry(options)`: Retries the sync event after a specified delay.
- `ErrorHandler.retryWithBackoff(options)`: Retries the sync event with exponential backoff.

#### Error filters

A filter can either be:

- An Error class. Only errors that are instances of the class will be handled.
- A function that takes an error as its argument and returns a boolean indicating whether to handle the error.

#### Error handler options

The `ErrorHandler.retry` and `ErrorHandler.retryWithBackoff` methods take an options object as their only argument.

- `maxRetries` (optional): The maximum number of retries. Defaults to 3.
- `baseDelay` (optional): The base delay in milliseconds between retries. Defaults to 1000.
- `backoff` (optional): Whether to use exponential backoff. Defaults to false.
- `persistent` (optional): Whether to reset the error handler after each retry. Defaults to false.

## Controller usage

To define a controller, you need to create an instance of `Controller` with a configuration object.

```typescript
import { Controller } from "@cardano-forge/barrow";

const controller = new Controller({
  syncClient: new OgmiosSyncClient({
    host: "localhost",
    port: 1337,
    tls: false,
  }),
  errorHandler: new ErrorHandler(),
  eventHandler: (event) => console.log(event),
});
```

Once you have a controller, you can start it by calling the `start` method and passing it a sync job configuration object.

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
```

The `start` method returns a promise that resolves when the sync job is started.

You can also wait for the sync job to complete by calling the `waitForCompletion` method.

```typescript
await controller.waitForCompletion();
```

The `waitForCompletion` method returns a promise that resolves when the sync job is completed.

## Sync job configuration

A sync job configuration object is used to define a sync job. It includes the following properties:

- `fn`: A function that handles sync events.
- `point`: The point to start syncing from.
- `throttle` (optional): The throttle duration for sync events.
- `filter` (optional): A function that filters sync events.
- `takeUntil` (optional): A function that takes the current state and returns a boolean indicating whether to stop syncing.

### Sync event

A sync event is an object that represents a sync event. It includes the following properties:

- `type`: The type of the sync event.
- `block`: The block that was synced.
- `tip`: The tip of the chain.

### Point

A point is an object that represents a point in the chain. It includes the following properties:

- `slot`: The slot number of the point.
- `id`: The hash of the point.

### Tip

A tip is an object that represents the tip of the chain. It includes the following properties:

- `slot`: The slot number of the tip.
- `id`: The hash of the tip.
- `height`: The height of the tip.

### Block

A block is an object that represents a block in the chain. It includes at least the following properties:

- `type`: The type of the block.
- `era`: The era of the block.
- `id`: The hash of the block.
- `height`: The height of the block.
- `slot` (optional): The slot number of the block.

### Schema

A schema is an object that represents the structure of sync events. It includes the following properties:

- `block`: The block that was synced.
- `point`: The point that was synced.
- `tip`: The tip of the chain.
- `pointOrOrigin`: The point or origin that was synced.
- `tipOrOrigin`: The tip or origin of the chain.

## Logger

Barrow provides a built-in logger that uses [Pino](https://getpino.io) for logging.

### Usage

First, make sur you have the required dependencies installed:

```bash
npm i pino
```

Then, create a pino logger instance:

```typescript
import { pinoLogger } from "@cardano-forge/barrow";
import { pino } from "pino";

const logger = pino();
```

You can now use the logger in your controller:

```typescript
const controller = new Controller({
  syncClient: new OgmiosSyncClient({
    host: "localhost",
    port: 1337,
    tls: false,
  }),
  logger: pinoLogger(logger),
});

## Tracing

Barrow provides a built-in tracing system that uses [OpenTelemetry](https://opentelemetry.io) for metrics and tracing.

### Usage

First, make sure you have the required dependencies installed:

```bash
npm i @opentelemetry/api
```

Then, create an instance of the OpenTelemetry API:

```typescript
import { metrics } from "@opentelemetry/api";
```

You can now use the OpenTelemetry API in your controller:

```typescript
const controller = new Controller({
  syncClient: new OgmiosSyncClient({
    host: "localhost",
    port: 1337,
    tls: false,
  }),
  tracingConfig: otelTracingConfig(),
});
```

The `otelTracingConfig` function takes an optional input that can be either a `Meter` instance or an object with the following properties:

- `name`: The name of the meter.
- `version` (optional): The version of the meter.
- `opts` (optional): The options for the meter.

### Metrics

Barrow provides the following built-in metrics:

- `status`: The status of the controller.
- `sync_tip_slot`: The slot number of the sync tip.
- `sync_tip_height`: The height of the sync tip.
- `chain_tip_slot`: The slot number of the chain tip.
- `chain_tip_height`: The height of the chain tip.
- `is_synced`: Whether the controller is synced.
- `processing_time`: The time it takes to process an event.
- `arrival_time`: The time it takes to receive an event.
- `apply_count`: The number of apply events.
- `reset_count`: The number of reset events.
- `filter_count`: The number of filtered events.
- `error_count`: The number of errors.

## Example

You can find examples of using Barrow in the `src/examples` directory.

To run an example, first install the dependencies:

```bash
npm i
```

Then, create a `.env` file in the root directory and add the following lines:

```dotenv
OGMIOS_NODE_HOST=<ogmios-node-host>
OGMIOS_NODE_PORT=<ogmios-node-port>
OGMIOS_NODE_TLS=<ogmios-node-tls>
```

Then, run the example:

```bash
npm run example kitchen-sink
```
