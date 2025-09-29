export type Entries<T extends object> = Array<[keyof T, T[keyof T]]>;

export function entries<T extends object>(obj: T): Entries<T> {
  return Object.entries(obj) as Entries<T>;
}
