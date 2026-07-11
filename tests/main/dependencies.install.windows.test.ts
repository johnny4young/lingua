/**
 * B5 — live Windows guard for the npm.cmd launch boundary.
 *
 * The general install suite injects spawn and pins the exact argv. This test
 * intentionally uses the real Node child_process implementation on win32 so
 * CI catches EINVAL/ENOENT regressions in the cmd.exe → npm.cmd handoff. The
 * registry points at a closed localhost port: success here means npm launched
 * and returned its normal non-zero network exit, not that CI downloaded a
 * package.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

describe.runIf(process.platform === 'win32')(
  'installJsDependencyBatch live Windows launcher',
  () => {
    let workdir = '';

    beforeAll(async () => {
      workdir = await mkdtemp(path.join(os.tmpdir(), 'lingua-b5-win-'));
      await writeFile(path.join(workdir, 'package.json'), '{}');
      await writeFile(
        path.join(workdir, '.npmrc'),
        [
          'registry=http://127.0.0.1:9/',
          'fetch-retries=0',
          'fetch-timeout=1000',
          'audit=false',
          'fund=false',
          '',
        ].join('\n')
      );
    });

    afterAll(async () => {
      if (workdir) await rm(workdir, { recursive: true, force: true });
    });

    it(
      'launches npm.cmd instead of failing at the process boundary',
      async () => {
      const { installJsDependencyBatch } = await import(
        '../../src/main/dependencies'
      );
      const logs: string[] = [];
      const result = await installJsDependencyBatch({
        runId: 'b5-live-windows',
        filePath: path.join(workdir, 'probe.js'),
        specifiers: ['lingua-b5-windows-spawn-probe-20260710'],
        onLog: (_stream, chunk) => logs.push(chunk),
      });

      expect(result.outcome).toBe('failed');
      expect(result.failureReason).toBe('exit-nonzero');
      expect(result.exitCode).not.toBe(-1);
      const output = logs.join('');
      expect(output).toMatch(/npm (?:error|ERR!)/iu);
      expect(output).not.toMatch(/not recognized|cannot find|could not find/iu);
      },
      15_000
    );
  }
);
