/**
 * Keeps an owner's newest response on screen when it never reaches storage, such
 * as a timeout, so another tab's write does not make this tab's result vanish.
 */
export function keepLatestTransient<R>(
  live: Readonly<Record<string, ReadonlyArray<R>>>,
  next: Readonly<Record<string, ReadonlyArray<R>>>,
  ownerExists: (id: string) => boolean,
  isTransient: (response: R) => boolean
): Record<string, ReadonlyArray<R>> {
  const kept: Record<string, ReadonlyArray<R>> = { ...next };
  for (const [id, list] of Object.entries(live)) {
    const latest = list[0];
    if (latest !== undefined && isTransient(latest) && ownerExists(id)) {
      kept[id] = [latest, ...(next[id] ?? [])];
    }
  }
  return kept;
}
