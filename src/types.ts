import type { Schema } from "@cardano-ogmios/client";

export type SyncEvent =
  | { type: "apply"; block: Schema.Block; tip: Schema.TipOrOrigin }
  | { type: "reset"; point: Schema.PointOrOrigin; tip: Schema.TipOrOrigin };

export type SyncClientSyncOpts = {
  points?: Schema.PointOrOrigin[];
};

export type SyncClient = {
  sync: (opts?: SyncClientSyncOpts) => AsyncIterable<SyncEvent>;
};
