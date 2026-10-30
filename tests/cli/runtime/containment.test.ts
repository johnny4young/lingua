import { describe, expect, it } from 'vitest';
import {
  CONTAINMENT_BACKENDS,
  probeContainment,
  type ReproContainmentBackend,
} from '../../../src/cli/runtime/containment';
import { REPRO_CONTROLS, type ReproBackendProbe } from '../../../src/shared/reproPolicy';

function probeFor(id: string): ReproBackendProbe {
  return {
    backend: { id, version: '1' },
    controls: Object.fromEntries(
      REPRO_CONTROLS.map(control => [control, 'enforced'])
    ) as ReproBackendProbe['controls'],
    ambientGrants: [],
  };
}

function backend(
  id: string,
  probe: () => Promise<ReproBackendProbe | null>
): ReproContainmentBackend {
  return { id, probe };
}

describe('probeContainment', () => {
  it('ships no backend yet, so the default probe finds none', async () => {
    expect(CONTAINMENT_BACKENDS).toEqual([]);
    expect(await probeContainment()).toBeNull();
  });

  it('returns the first backend that answers on this host', async () => {
    const result = await probeContainment([
      backend('absent', async () => null),
      backend('present', async () => probeFor('present')),
      backend('later', async () => probeFor('later')),
    ]);

    expect(result?.backend.id).toBe('present');
  });

  it('treats a probe that throws as an absent backend', async () => {
    const result = await probeContainment([
      backend('broken', async () => {
        throw new Error('sandbox-exec missing');
      }),
    ]);

    expect(result).toBeNull();
  });
});
