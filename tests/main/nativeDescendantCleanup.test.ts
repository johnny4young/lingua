import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnNativeRun } from '../../src/main/runners/spawnNativeRun';

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

// Real processes, independent pipes: parent close must not stand in for tree exit.
// Windows has no POSIX groups; its real tree-first fixture lives separately.
describe.runIf(process.platform !== 'win32')('cancelled native descendants', () => {
  it.each(['stop', 'timeout', 'success'] as const)('%s preserves the tree lifetime contract', async mode => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lingua-descendant-'));
    const readyFile = path.join(directory, 'child.pid');
    const controller = new AbortController();
    let parentPid = 0;
    let parentOutput = '';
    let childPid = 0;
    const childSource = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(readyFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const source = `
      console.log(process.pid);
      require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], { stdio: 'ignore' }).unref();
      ${mode === 'success' ? '' : 'setInterval(() => {}, 1000);'}
    `;
    const pending = spawnNativeRun({
      command: process.execPath, args: ['-e', source], env: process.env,
      timeoutMs: mode === 'timeout' ? 2000 : 10000, killEscalationMs: 200,
      maxOutputBytes: 4096, stdoutTruncationMarker: '', stderrTruncationMarker: '',
      signal: controller.signal,
      onStdout: chunk => {
        parentOutput += chunk;
        if (parentOutput.includes('\n')) parentPid = Number(parentOutput.trim());
      },
    });
    try {
      await expect.poll(async () => {
        try { childPid = Number(await readFile(readyFile, 'utf8')); return childPid > 0; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
      }, { timeout: 5000 }).toBe(true);
      expect(alive(childPid)).toBe(true);
      if (mode === 'stop') controller.abort();
      const result = await pending;
      expect(result).toMatchObject({ killed: mode === 'stop', timedOut: mode === 'timeout' });
      expect(result.spawnError).toBeUndefined();
      expect(parentPid).toBeGreaterThan(0);
      expect(alive(parentPid)).toBe(false);
      if (mode === 'success') {
        expect(result.exitCode).toBe(0);
        expect(alive(childPid)).toBe(true); // Normal background work is not a cancellation.
      } else {
        await expect.poll(() => alive(childPid), { timeout: 1000 }).toBe(false);
      }
    } finally {
      controller.abort();
      // Clean exact fixture identities even when a regression leaves an orphan.
      try { childPid ||= Number(await readFile(readyFile, 'utf8')); } catch { /* Not started. */ }
      if (parentPid > 0) { try { process.kill(-parentPid, 'SIGKILL'); } catch { /* Group gone. */ } }
      if (childPid > 0) { try { process.kill(childPid, 'SIGKILL'); } catch { /* Child gone. */ } }
      await pending;
      if (childPid > 0) await expect.poll(() => alive(childPid), { timeout: 1000 }).toBe(false);
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);
});
