/** Build a Node lookup function pinned to addresses already cleared by SSRF policy. */

import type { LookupFunction } from 'node:net';

export interface PinnedAddress {
  readonly address: string;
  readonly family: number;
}

export function createPinnedLookup(
  addresses: ReadonlyArray<PinnedAddress>
): LookupFunction {
  const lookup = (
    _hostname: string,
    options: unknown,
    callback: (...args: unknown[]) => void
  ): void => {
    const requestedFamily =
      typeof options === 'number'
        ? options
        : options && typeof options === 'object' && 'family' in options
          ? Number((options as { family?: unknown }).family ?? 0)
          : 0;
    const eligible = addresses.filter(
      (entry) => requestedFamily === 0 || entry.family === requestedFamily
    );
    const selected = eligible[0] ?? addresses[0];
    if (!selected) {
      callback(new Error('DNS resolution returned no addresses'));
      return;
    }
    const wantsAll =
      options !== null &&
      typeof options === 'object' &&
      'all' in options &&
      (options as { all?: unknown }).all === true;
    if (wantsAll) callback(null, eligible.length > 0 ? eligible : addresses);
    else callback(null, selected.address, selected.family);
  };
  return lookup as LookupFunction;
}
