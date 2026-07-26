/**
 * implementation — live Windows guard for the npm.cmd launch boundary.
 *
 * The general install suite injects spawn and pins the exact argv. This test
 * intentionally uses the real Node child_process implementation on win32 so
 * CI catches EINVAL/ENOENT regressions in the cmd.exe → npm.cmd handoff. The
 * registry points at a closed localhost port: success here means npm launched
 * and returned its normal non-zero network exit, not that CI downloaded a
 * package.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DependencyInstallResult } from '../../src/main/dependencies';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

describe.runIf(process.platform === 'win32')(
  'installJsDependencyBatch live Windows launcher',
  () => {
    const runId = 'native-deps-live-windows';
    let workdir = '';
    let registry: Server | null = null;
    let installPromise: Promise<DependencyInstallResult> | null = null;

    beforeAll(async () => {
      workdir = await mkdtemp(path.join(os.tmpdir(), 'lingua-native-deps-win-'));
      await writeFile(path.join(workdir, 'package.json'), '{}');

      // A closed port made this guard dependent on Windows/npm connection
      // timing: the same command usually failed in ~3.5s but occasionally
      // remained alive past Vitest's 15s timeout, then held the temp directory
      // open and made cleanup fail with EBUSY. A loopback registry returning a
      // deterministic 404 exercises the real npm.cmd process boundary without
      // external I/O or scheduler-sensitive connection refusal.
      registry = createServer((_request, response) => {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end('{"error":"not_found"}');
      });
      await new Promise<void>((resolve, reject) => {
        registry!.once('error', reject);
        registry!.listen(0, '127.0.0.1', () => {
          registry!.off('error', reject);
          resolve();
        });
      });
      const address = registry.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Loopback npm registry did not bind to a TCP port');
      }

      await writeFile(
        path.join(workdir, '.npmrc'),
        [
          `registry=http://127.0.0.1:${address.port}/`,
          'fetch-retries=0',
          'fetch-timeout=1000',
          'audit=false',
          'fund=false',
          '',
        ].join('\n')
      );
    });

    // Cleanup gets the same headroom, and for a sharper reason: the failure
    // this suite already hit once was the npm process outliving the test and
    // holding the temp directory open, so `rm` retried into an EBUSY. That
    // path — cancel, await the exit, close the server, retry the delete —
    // runs against vitest's 10s default hook timeout otherwise.
    afterAll(async () => {
      if (installPromise) {
        const { cancelJsDependencyInstall } = await import(
          '../../src/main/dependencies'
        );
        cancelJsDependencyInstall(runId);
        await installPromise;
      }
      if (registry) {
        await new Promise<void>((resolve, reject) => {
          registry!.close(error => (error ? reject(error) : resolve()));
        });
      }
      if (workdir) {
        await rm(workdir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    }, 60_000);

    it(
      'launches npm.cmd instead of failing at the process boundary',
      async () => {
        const { installJsDependencyBatch } = await import(
          '../../src/main/dependencies'
        );
        const logs: string[] = [];
        installPromise = installJsDependencyBatch({
          runId,
          filePath: path.join(workdir, 'probe.js'),
          specifiers: ['lingua-windows-spawn-probe'],
          onLog: (_stream, chunk) => logs.push(chunk),
        });
        const result = await installPromise;
        installPromise = null;

        expect(result.outcome).toBe('failed');
        expect(result.failureReason).toBe('exit-nonzero');
        expect(result.exitCode).not.toBe(-1);
        const output = logs.join('');
        expect(output).toMatch(/npm (?:error|ERR!)/iu);
        expect(output).not.toMatch(/not recognized|cannot find|could not find/iu);
      },
      // Deliberately generous. This asserts a process-boundary behaviour —
      // that cmd.exe hands off to npm.cmd at all — not how fast npm runs. A
      // green run exits as soon as npm does, so the ceiling costs nothing;
      // it only comes into play on a runner slow enough that a tight limit
      // would report a launcher regression that did not happen. 15s was
      // being exceeded on shared Windows runners and turned this guard into
      // a coin flip, which trains people to re-run it without reading.
      60_000
    );
  }
);
