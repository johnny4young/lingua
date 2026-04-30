/**
 * Lightweight semver compare for `MAJOR.MINOR.PATCH` versions.
 *
 * RL-061 Slice 5 — used by the web update banner to decide whether
 * the remote release tag is strictly newer than the bundle's
 * build-time pin. Mirrors the worker's `update-server/src/version.ts:isNewer`
 * helper intentionally — main / renderer / update-server cannot
 * share a single module (different bundlers + main has its own
 * node_modules boundary), so the same logic lives in two places
 * with parity pinned in tests.
 *
 * Lingua only publishes stable tags. No prerelease / build-metadata
 * support — anything beyond `MAJOR.MINOR.PATCH` returns `null` from
 * `parseVersion` and `isVersionNewer` becomes `false`, which
 * conservatively keeps the banner hidden rather than fire on a
 * malformed input.
 */

export function parseVersion(input: string): [number, number, number] | null {
  if (typeof input !== 'string') return null;
  const clean = input.startsWith('v') ? input.slice(1) : input;
  const parts = clean.split('.');
  if (parts.length !== 3) return null;
  if (parts.some((part) => !/^(0|[1-9]\d*)$/u.test(part))) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
  return nums as [number, number, number];
}

/** Returns `true` when `latest` is strictly newer than `current`. */
export function isVersionNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}
