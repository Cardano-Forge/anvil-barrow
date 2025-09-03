import type { Schema } from "@cardano-ogmios/client";
import type { SyncClient, SyncEvent } from "./types";

export type ControllerConfig = {
  syncClient: SyncClient;
};

export type ControllerStartOpts = {
  points?: Schema.PointOrOrigin[];
  take?: number;
};

export class Controller {
  constructor(protected _config: ControllerConfig) {}

  async *start(opts: ControllerStartOpts = {}): AsyncIterable<SyncEvent> {
    try {
      let processed = 0;
      for await (const event of this._config.syncClient.sync(opts)) {
        yield event;
        if (opts.take && ++processed >= opts.take) {
          break;
        }
      }
    } catch (error) {
      console.error(error);
    }
  }
}
