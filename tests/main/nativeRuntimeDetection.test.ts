import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpawnNativeRunResult } from '../../src/main/runners/spawnNativeRun';

const spawnNativeRun = vi.hoisted(() => vi.fn());
vi.mock('../../src/main/runners/spawnNativeRun', () => ({ spawnNativeRun }));

import { detectNativeRuntimeVersion } from '../../src/main/runners/nativeRuntimeDetection';

function probe(overrides: Partial<SpawnNativeRunResult>): SpawnNativeRunResult {
  return { stdout: '', stderr: '', exitCode: 0, executionTime: 1, timedOut: false, killed: false, ...overrides };
}

const request = { command: 'deno', env: {}, killEscalationMs: 200 };

describe('native runtime version probes', () => {
  beforeEach(() => spawnNativeRun.mockReset());

  it('returns the trimmed version of an installed runtime', async () => {
    spawnNativeRun.mockResolvedValue(probe({ stdout: 'deno 2.1.0\n' }));
    expect(await detectNativeRuntimeVersion(request)).toEqual({ version: 'deno 2.1.0' });
  });

  it('reports only a missing executable as missing', async () => {
    spawnNativeRun.mockResolvedValue(probe({
      exitCode: -1,
      spawnError: Object.assign(new Error('spawn deno ENOENT'), { code: 'ENOENT' }),
    }));
    expect(await detectNativeRuntimeVersion(request)).toEqual({ version: null, reason: 'missing' });
  });

  it.each([
    ['a timeout', probe({ timedOut: true, exitCode: -1 })],
    ['a failing binary', probe({ exitCode: 1 })],
    ['a permission error', probe({ exitCode: -1, spawnError: Object.assign(new Error('EACCES'), { code: 'EACCES' }) })],
  ])('reports %s as a failed check', async (_label, result) => {
    spawnNativeRun.mockResolvedValue(result);
    expect(await detectNativeRuntimeVersion(request)).toEqual({ version: null, reason: 'check-failed' });
  });
});
