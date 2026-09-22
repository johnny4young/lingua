import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createNativeRunLifecycle, disposeNativeRuns } from '../../src/main/runners/nativeRunLifecycle';
import { spawnNativeRun } from '../../src/main/runners/spawnNativeRun';

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

describe.runIf(process.platform === 'win32')('real Windows native process trees', () => {
  it.each(['owner', 'stopped-owner', 'shutdown'])('reaps parent and grandchild on %s', async action => {
    const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false });
    const lifecycle = createNativeRunLifecycle(owner);
    const pids = new Set<number>();
    let output = '';
    const childSource = "process.on('SIGTERM', () => {}); console.log('OWNED_PID=' + process.pid); setInterval(() => {}, 1000);";
    const parentSource = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], { stdio: ['ignore', 'inherit', 'inherit'] }); ${childSource}`;
    const running = spawnNativeRun({
      command: process.execPath, args: ['-e', parentSource], env: process.env,
      timeoutMs: 5000, killEscalationMs: 200, maxOutputBytes: 4096,
      stdoutTruncationMarker: '', stderrTruncationMarker: '', signal: lifecycle.controller.signal,
      onStdout: chunk => {
        output += chunk;
        for (const match of output.matchAll(/OWNED_PID=(\d+)\r?\n/g)) pids.add(Number(match[1]));
      },
    });
    try {
      await vi.waitFor(() => expect(pids.size).toBe(2), { timeout: 5000 });
      expect([...pids].every(alive)).toBe(true);
      if (action === 'stopped-owner') lifecycle.controller.abort();
      if (action === 'shutdown') disposeNativeRuns();
      else owner.emit('destroyed');
      await vi.waitFor(() => expect([...pids].every(pid => !alive(pid))).toBe(true), { timeout: 5000 });
      expect((await running).killed).toBe(true);
    } finally {
      disposeNativeRuns();
      lifecycle.release();
      // Exact fixture PIDs only; failure paths must not leave hosted-runner children.
      for (const pid of pids) {
        if (!alive(pid)) continue;
        try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 3000, stdio: 'ignore' }); } catch {}
      }
      await running;
    }
  }, 20000);
});
