/** Deep mutable view of an artifact, so a table row can tamper with it in place. */
export type Tamperable<T> = T extends readonly (infer U)[]
  ? Tamperable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Tamperable<T[K]> }
    : T;

/**
 * Deep-copies `value`, applies `mutate`, and returns the JSON text a parser would
 * receive. Rows write values the schema forbids with `Object.assign`.
 */
export function tamperJson<T>(value: T, mutate: (raw: Tamperable<T>) => void): string {
  const raw = structuredClone(value) as Tamperable<T>;
  mutate(raw);
  return JSON.stringify(raw);
}
