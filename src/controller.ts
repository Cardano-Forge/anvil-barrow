import type { Schema } from "@cardano-ogmios/client";
import type { SyncClient, SyncEvent } from "./types";

/*
Functions:
  - start
  - stop

Options:
  - Retry strategies per error constructor

Extensions:
  - withChainClient - adds resume capability

*/

export type ControllerConfig = {
  syncClient: SyncClient;
};

export type ControllerSyncOpts = {
  points?: Schema.PointOrOrigin[];
  take?: number;
};

export class Controller {
  constructor(protected _config: ControllerConfig) {}

  async *sync(opts: ControllerSyncOpts = {}): AsyncIterable<SyncEvent> {
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
