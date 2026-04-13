/**
 * Lightweight semver comparison for MAJOR.MINOR.PATCH versions.
 * No prerelease or build metadata support — lingua only publishes stable tags.
 */

export function parseVersion(tag: string): [number, number, number] | null {
  const clean = tag.startsWith('v') ? tag.slice(1) : tag;
  const parts = clean.split('.');
  if (parts.length !== 3) return null;

  const nums = parts.map(Number);
  if (nums.some(isNaN)) return null;

  return nums as [number, number, number];
}

/** Returns true when `latest` is strictly newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;

  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}
