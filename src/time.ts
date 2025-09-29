export const mulitpliersPerUnit = {
  milliseconds: 1,
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
} as const;

export type Unit = keyof typeof mulitpliersPerUnit;

export function toMilliseconds(value: number, unit: Unit): number {
  return value * mulitpliersPerUnit[unit];
}
