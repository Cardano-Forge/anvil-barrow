# ProcessController Refactoring Plan

## Goal
Extract a base `ProcessController` class from the current `Controller` to support non-sync long-running processes (e.g., mempool watcher). The base class provides logging, tracing, and error handling. Subclasses implement sync-specific or other process logic.

## File Structure

```
src/
├── process-controller.ts    # Abstract base class
├── sync-controller.ts       # SyncController (current Controller)
├── types/
│   └── process-controller.ts # Shared types for base controller
├── index.ts                 # Update exports
```

## Type Design

### `types/process-controller.ts`

**Generic type parameters:**
- `TEvent` - event type yielded by the process
- `TMeta` - subclass-specific metadata
- `TCounters extends ProcessControllerStateCounters` - counters (base has `errorCount`)
- `TStartingPoint` - point type to start from (optional)
- `TResumePoint` - point type for resume (can be `undefined` if not resumable)

**Core types:**

```typescript
// Base counters - required in all subclasses
type ProcessControllerStateCounters = {
  errorCount: number;
};

// State types - generic over counters
type ProcessControllerStateRunning<TEvent, TMeta, TCounters extends ProcessControllerStateCounters> = {
  status: "running";
  generator: AsyncGenerator<TEvent, void>;
  promise: Promise<void>;
  startedAt: number;
  counters: TCounters;
  meta: TMeta;
  lastError: Error | undefined;
};

type ProcessControllerStateStopped<TMeta, TCounters extends ProcessControllerStateCounters> = {
  status: "paused" | "done" | "crashed";
  stoppedAt: number;
  startedAt: number;
  counters: TCounters;
  meta: TMeta;
  lastError: Error | undefined;
};

type ProcessControllerStateIdle = { status: "idle" };

// Config & options
type ProcessControllerConfig<TEvent, TMeta, TStartingPoint, TResumePoint> = {
  errorHandler?: ErrorHandler;
  logger?: (logEvent: ProcessControllerLogEvent<...>) => void;
  tracingConfig?: TracingConfig;
};

type ProcessControllerStartOpts<TEvent, TMeta, TStartingPoint> = {
  point?: TStartingPoint;
  fn?: (event: TEvent) => MaybePromise<{ done: boolean } | void>;
  throttle?: [number, Unit];
  filter?: (event: TEvent) => MaybePromise<boolean>;
  takeUntil?: (data: { lastEvent: TEvent; state: ProcessControllerStateRunning }) => MaybePromise<boolean>;
};
```

**Log event types:** Generic over event type, counters, and point types.

## Abstract Class Design

### `process-controller.ts`

**Abstract methods for subclasses:**

```typescript
abstract class ProcessController<TEvent, TMeta, TCounters, TStartingPoint, TResumePoint> {
  // Create event stream from optional starting point
  protected abstract _initEventStream(point?: TStartingPoint): AsyncGenerator<TEvent, void>;

  // Process a single event, return { done: true } to stop
  protected abstract _processEvent(event: TEvent, state: ProcessControllerStateRunning): Promise<{ done: boolean } | void>;

  // Get resume point (return undefined if not resumable)
  protected abstract _getResumePoint(state: ProcessControllerStateRunning): TResumePoint | undefined;
}
```

**Concrete methods in base class:**

| Method | Description |
|--------|-------------|
| `start(opts)` | Initialize event stream, run loop |
| `pause()` | Call `generator.return()`, update status |
| `resume()` | Call `_getResumePoint()`, reinit stream, continue |
| `stop()` | Same as pause (stop the generator) |
| `waitForCompletion()` | Await the loop promise |
| `_runLoop()` | Event loop with throttle, filter, error handling, metrics |
| `_emitLogEvent()` | Safe logging wrapper |
| `_handleError()` | ErrorHandler invocation, retry logic |

**Pause/Resume behavior:**
- `pause()` always works (calls `generator.return()`)
- `resume()` calls `_getResumePoint()` - subclasses return `undefined` if not resumable
- If `_getResumePoint()` returns `undefined`, `resume()` throws error ("not resumable")

## SyncController Implementation

### `sync-controller.ts`

**Extends `ProcessController<SyncEvent<TSchema>, SyncMeta, SyncCounters, TSchema["startingPoint"], TSchema["tip"]>`**

**Sync-specific types:**

```typescript
type SyncMeta = {
  startingPoint: TSchema["startingPoint"];
  syncTip: TSchema["tip"] | undefined;
  chainTip: TSchema["tip"] | undefined;
};

type SyncCounters = ProcessControllerStateCounters & {
  filterCount: number;
  applyCount: number;
  resetCount: number;
};
```

**Implementations:**

```typescript
class SyncController<TSchema extends Schema> extends ProcessController<...> {
  protected _initEventStream(point: TSchema["startingPoint"]): AsyncGenerator<SyncEvent<TSchema>> {
    return this._syncClient.sync({ point });
  }

  protected _processEvent(event: SyncEvent<TSchema>): Promise<{ done: boolean } | void> {
    // Set chainTip, syncTip from event
    // Update counters (applyCount, resetCount)
    // Return { done: true } if sync complete
  }

  protected _getResumePoint(state): TSchema["tip"] | undefined {
    return state.meta.syncTip ?? state.meta.startingPoint;
  }
}
```

**Breaking change:** `SyncController` requires `point` in `start()` (not optional), while base `ProcessController` allows optional.

## Implementation Order

1. **Create `src/types/process-controller.ts`** - Define all base types
2. **Create `src/process-controller.ts`** - Abstract base class with generic types
3. **Create `src/sync-controller.ts`** - Move current `Controller` code, extend base
4. **Update `src/index.ts`** - Export `SyncController` (keep backward compat alias `Controller`)
5. **Update imports in repo** - Replace `Controller` with `SyncController` internally
6. **Run tests** - Verify no regressions

## Backward Compatibility

- Export `SyncController` as primary name
- Export `Controller` as alias: `export { SyncController as Controller }`
- Existing consumers of `Controller` continue to work

## Test Updates

Tests in `controller.test.ts` should be renamed to `sync-controller.test.ts` and updated to use `SyncController` explicitly.

## Optional Future Enhancements (Out of Scope)

- State persistence hook (`_serializeState()` / `_deserializeState()`)
- Pause/resume state serialization for non-resumable processes
- Event batching for high-throughput processes
