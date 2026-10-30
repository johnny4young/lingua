import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  CONTAINMENT_BACKENDS,
  probeContainment,
  resolveReproNodeRuntime,
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
  return {
    id,
    probe,
    async launch() {
      throw new Error('not launched in these tests');
    },
  };
}

describe('probeContainment', () => {
  it('ships the macOS Seatbelt backend as the only backend', () => {
    expect(CONTAINMENT_BACKENDS.map(entry => entry.id)).toEqual(['macos-seatbelt']);
  });

  it.skipIf(process.platform === 'darwin')('finds no backend outside macOS', async () => {
    expect(await probeContainment()).toBeNull();
  });

  it('returns the first backend that answers on this host', async () => {
    const result = await probeContainment([
      backend('absent', async () => null),
      backend('present', async () => probeFor('present')),
      backend('later', async () => probeFor('later')),
    ]);

    expect(result?.backend.id).toBe('present');
    expect(result?.probe.backend.id).toBe('present');
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

describe('resolveReproNodeRuntime', () => {
  it('reports the canonical path and version of the Node.js running the tests', async () => {
    const runtime = await resolveReproNodeRuntime(process.execPath);

    expect(runtime?.version).toBe(process.versions.node);
    expect(runtime?.path).toMatch(/node(\.exe)?$/u);
  });

  it('returns null for a binary that does not exist', async () => {
    expect(await resolveReproNodeRuntime('/nonexistent/bin/node')).toBeNull();
  });

  it('finds a bare command on PATH', async () => {
    const runtime = await resolveReproNodeRuntime(
      process.platform === 'win32' ? 'node.exe' : 'node'
    );

    expect(runtime?.version).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it('returns null for a command that is not on PATH', async () => {
    expect(await resolveReproNodeRuntime('lingua-no-such-node-binary')).toBeNull();
  });
});
