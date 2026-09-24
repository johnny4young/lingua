/**
 * Passive menu and palette probes spawn host binaries. Reuse a recent positive
 * answer for the same runtime and environment; missing or failed checks are
 * always probed again so a fresh install is noticed.
 */
const POSITIVE_TTL_MS = 5 * 60_000;
const recent = new Map<string, { at: number; result: unknown }>();

export async function cachedNativeProbe<T extends { installed: boolean }>(
  runtime: string,
  env: Record<string, string>,
  probe: () => Promise<T>,
  { refresh = false }: { refresh?: boolean } = {}
): Promise<T> {
  const key = `${runtime}\0${JSON.stringify(env)}`;
  const hit = recent.get(key);
  if (!refresh && hit && Date.now() - hit.at < POSITIVE_TTL_MS) return hit.result as T;
  const result = await probe();
  if (result.installed) recent.set(key, { at: Date.now(), result });
  else recent.delete(key);
  return result;
}

export function resetNativeProbeCacheForTests(): void {
  recent.clear();
}
