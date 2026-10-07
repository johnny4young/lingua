import { describe, expect, it } from 'vitest';
import { spawnNativeRun } from '../../src/main/runners/spawnNativeRun';

const baseOptions = {
  command: process.execPath,
  env: { PATH: process.env.PATH },
  killEscalationMs: 200,
  maxOutputBytes: 1024 * 1024,
  stdoutTruncationMarker: '[truncated]',
  stderrTruncationMarker: '[truncated]',
};

describe('spawnNativeRun stdio decoding and settlement', () => {
  it('keeps multi-byte characters intact across chunk boundaries', async () => {
    const result = await spawnNativeRun({
      ...baseOptions,
      args: ['-e', "process.stdout.write('€'.repeat(200000)); process.stderr.write('ñ'.repeat(100000))"],
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('€'.repeat(200000));
    expect(result.stderr).toBe('ñ'.repeat(100000));
  });

  // A setsid grandchild leaves the process group, so the tree kill cannot reach it.
  it.runIf(process.platform !== 'win32')(
    'settles a timed-out run while an escaped grandchild still holds stdout',
    async () => {
      const source =
        "const c = require('child_process').spawn('/bin/sleep', ['8'], { stdio: 'inherit', detached: true }); c.unref(); console.log('pid', c.pid); setInterval(() => {}, 1000);";
      const startedAt = Date.now();
      const result = await spawnNativeRun({ ...baseOptions, args: ['-e', source], timeoutMs: 1000 });
      const elapsed = Date.now() - startedAt;
      const grandchild = Number(/pid (\d+)/u.exec(result.stdout)?.[1]);
      try {
        expect(result.timedOut).toBe(true);
        expect(elapsed).toBeLessThan(3000);
      } finally {
        if (grandchild > 0) {
          try { process.kill(grandchild, 'SIGKILL'); } catch { /* Already gone. */ }
        }
      }
    },
    15_000
  );

  it.runIf(process.platform !== 'win32')(
    'settles a stopped run while an escaped grandchild still holds stdout',
    async () => {
      const controller = new AbortController();
      const source =
        "const c = require('child_process').spawn('/bin/sleep', ['8'], { stdio: 'inherit', detached: true }); c.unref(); console.log('pid', c.pid); setInterval(() => {}, 1000);";
      let output = '';
      const pending = spawnNativeRun({
        ...baseOptions,
        args: ['-e', source],
        timeoutMs: 10_000,
        signal: controller.signal,
        onStdout: chunk => {
          output += chunk;
          if (output.includes('\n')) controller.abort();
        },
      });
      const startedAt = Date.now();
      const result = await pending;
      const grandchild = Number(/pid (\d+)/u.exec(result.stdout)?.[1]);
      try {
        expect(result.killed).toBe(true);
        expect(Date.now() - startedAt).toBeLessThan(3000);
      } finally {
        if (grandchild > 0) {
          try { process.kill(grandchild, 'SIGKILL'); } catch { /* Already gone. */ }
        }
      }
    },
    15_000
  );
});
