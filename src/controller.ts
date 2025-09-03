import type { Schema } from "@cardano-ogmios/client";
import type { SyncClient, SyncEvent } from "./types";

export type ControllerConfig = {
  syncClient: SyncClient;
};

export type ControllerStartOpts = {
  points?: Schema.PointOrOrigin[];
  take?: number;
  throttle?: number;
};

export type ControllerState = {
  processed: number;
  events: AsyncGenerator<SyncEvent, void>;
};

export class Controller {
  protected _state: ControllerState | undefined = undefined;

  constructor(protected _config: ControllerConfig) {}

  async *start(opts: ControllerStartOpts = {}): AsyncIterable<SyncEvent> {
    try {
      const events = this._config.syncClient.sync(opts);
      this._state = { processed: 0, events };
      for await (const event of events) {
        yield event;
        if (opts.take && ++this._state.processed >= opts.take) {
          this.stop();
        }
        if (opts.throttle) {
          await new Promise((resolve) => setTimeout(resolve, opts.throttle));
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  stop() {
    if (this._state) {
      this._state.events.return();
      this._state = undefined;
    }
  }
}
