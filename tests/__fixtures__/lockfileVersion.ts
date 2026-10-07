/** Strict x.y.z floor check shared by the lockfile security ratchets. */
export function atLeast(version: string, minimum: readonly [number, number, number]): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (parts[index]! !== minimum[index]) return parts[index]! > minimum[index]!;
  }
  return true;
}
