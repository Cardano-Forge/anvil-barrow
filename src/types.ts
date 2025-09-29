export type Point = {
  slot: number;
  id: string;
};

export type Tip = {
  slot: number;
  id: string;
  height: number;
};

export type Block =
  | {
      type: "ebb";
      era: "byron";
      id: string;
      height: number;
    }
  | {
      type: "bft";
      era: "byron";
      id: string;
      height: number;
      slot: number;
    }
  | {
      type: "praos";
      era: "shelley" | "allegra" | "mary" | "alonzo" | "babbage" | "conway";
      id: string;
      height: number;
      slot: number;
    };

export type Schema<
  TBlock extends Block = Block,
  TPoint extends Point = Point,
  TTip extends Tip = Tip,
  TOrigin extends string = string,
> = {
  block: TBlock;
  point: TPoint;
  tip: TTip;
  pointOrOrigin: TPoint | TOrigin;
  tipOrOrigin: TTip | TOrigin;
};

export type SyncEvent<TSchema extends Schema> =
  | { type: "apply"; block: TSchema["block"]; tip: TSchema["tipOrOrigin"] }
  | {
      type: "reset";
      point: TSchema["pointOrOrigin"];
      tip: TSchema["tipOrOrigin"];
    };

export type SyncClientSyncOpts<TSchema extends Schema> = {
  point?: TSchema["pointOrOrigin"];
};

export type SyncClient<TSchema extends Schema> = {
  sync: (
    opts?: SyncClientSyncOpts<TSchema>,
  ) => AsyncGenerator<SyncEvent<TSchema>, void>;
};

export type MaybePromise<T> = T | Promise<T>;
