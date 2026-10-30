// SPDX-License-Identifier: MIT
/**
 * Containment backends for permissioned reproductions.
 *
 * A backend reports what it can enforce on this host before anything runs.
 * No backend ships yet, so every permissioned run is refused before launch.
 */

import type { ReproBackendProbe } from '../../shared/reproPolicy';

export interface ReproContainmentBackend {
  readonly id: string;
  /** Null when the backend cannot run on this host at all. */
  probe(): Promise<ReproBackendProbe | null>;
}

export const CONTAINMENT_BACKENDS: readonly ReproContainmentBackend[] = [];

/** First backend that answers its probe on this host, or null. A probe that throws counts as absent. */
export async function probeContainment(
  backends: readonly ReproContainmentBackend[] = CONTAINMENT_BACKENDS
): Promise<ReproBackendProbe | null> {
  for (const backend of backends) {
    try {
      const probe = await backend.probe();
      if (probe) return probe;
    } catch {
      // Fail closed: an unanswered probe is the same as no backend.
    }
  }
  return null;
}
