export type MaybePromise<T> = T | Promise<T>;

export type AnyEvent = { type: string };

export type EventType<TEvent extends AnyEvent> = string extends TEvent["type"]
  ? never
  : TEvent["type"];

export type Counters<TEvent extends AnyEvent> = {
  [K in EventType<TEvent> as `${K}Count`]: number;
};

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
  onEventProcessed?(event: Def["event"], mut: { meta: Def["meta"] }): void;
  run(opts: Def["opts"]): AsyncGenerator<Def["event"], void>;
  resume(meta: Def["meta"]): AsyncGenerator<Def["event"], void>;
};

export function getEventCounterKey<TEvent extends AnyEvent>(event: TEvent) {
  const eventType = event.type as EventType<TEvent>;
  return `${eventType}Count` as const;
}
