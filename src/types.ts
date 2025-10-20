export type Point =
  | {
      slot: number;
      id: string;
    }
  | string;

export type Tip =
  | {
      slot: number;
      id: string;
      height: number;
    }
  | string;

export type Block =
  | {
      type: "ebb";
      era: "byron";
      id: string;
      height: number;
      slot?: undefined;
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
  TResetPoint extends Point = Point,
  TStartingPoint extends Point = Point,
  TTip extends Tip = Tip,
> = {
  block: TBlock;
  resetPoint: TResetPoint;
  startingPoint: TStartingPoint;
  tip: TTip;
};

export type SyncEvent<TSchema extends Schema> =
  | {
      type: "apply";
      block: TSchema["block"];
      tip: TSchema["tip"];
    }
  | {
      type: "reset";
      point: TSchema["resetPoint"];
      tip: TSchema["tip"];
    };

export type SyncClientSyncOpts<TSchema extends Schema> = {
  point: TSchema["startingPoint"];
};

export type SyncClient<TSchema extends Schema> = {
  sync: (
    opts: SyncClientSyncOpts<TSchema>,
  ) => AsyncGenerator<SyncEvent<TSchema>, void>;
};

export type MaybePromise<T> = T | Promise<T>;
