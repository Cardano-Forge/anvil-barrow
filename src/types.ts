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

export type RunnerDef<
  // biome-ignore lint/suspicious/noExplicitAny: Need flexible parameters
  TMeta = any,
  // biome-ignore lint/suspicious/noExplicitAny: Need flexible parameters
  TOpts = any,
  TEvent extends AnyEvent = AnyEvent,
> = {
  meta: TMeta;
  opts: TOpts;
  event: TEvent;
};

export type Runner<Def extends RunnerDef> = {
  createMeta(opts: Def["opts"]): Def["meta"];
  createCounters(opts: Def["opts"]): Counters<Def["event"]>;
  run(opts: Def["opts"]): AsyncGenerator<Def["event"], void>;
  resume(meta: Def["meta"]): AsyncGenerator<Def["event"], void>;
};

export type AnyEvent = { type: string };

export type EventType<TEvent extends AnyEvent> = string extends TEvent["type"]
  ? never
  : TEvent["type"];

export type Counters<TEvent extends AnyEvent> = {
  [K in EventType<TEvent> as `${K}Count`]: number;
};
