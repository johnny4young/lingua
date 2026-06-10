/**
 * Process-tree termination helpers for the native runners.
 *
 * `child.kill()` signals only the direct child: user code that spawns its own
 * children (a dev server, `child_process.fork`, a shell pipeline) leaves those
 * grandchildren running after a timeout/Stop, silently leaking processes the
 * user believes were stopped. The fix is platform-split:
 *
 *   - POSIX: spawn the runner child `detached` so it becomes the leader of a
 *     NEW process group, then signal the whole group via `process.kill(-pid)`.
 *     Without `detached`, `-pid` would target the parent's own group (i.e.
 *     Lingua's main process) — which is why `detachedSpawnOptions()` and
 *     `killProcessTree()` must always be used together.
 *   - Windows: `detached` would allocate a new console, and POSIX process
 *     groups do not exist; tree termination goes through
 *     `taskkill /pid <pid> /T /F` at the hard-kill stage instead.
 *
 * Both paths fall back to plain `child.kill(signal)` when the group/taskkill
 * route is unavailable (child never spawned, already reaped, test doubles
 * without a pid), so callers keep the previous single-process behavior as the
 * floor, never less.
 */

import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const isWindows = process.platform === 'win32';

/**
 * Spawn options fragment that makes the child a process-group leader on
 * POSIX (no-op on Windows). Spread into the runner's `spawn(...)` options.
 */
export function detachedSpawnOptions(): { detached: boolean } {
  return { detached: !isWindows };
}

/**
 * Best-effort terminate the child AND everything it spawned.
 *
 * POSIX: signals the child's process group (`-pid`); falls back to the direct
 * child if the group signal fails (ESRCH after reap, EPERM, missing pid).
 * Windows: SIGTERM-stage signals the direct child only (there is no graceful
 * tree signal); SIGKILL-stage runs `taskkill /T /F` to fell the whole tree.
 * Never throws — termination races with natural exit by design.
 */
export function killProcessTree(
  child: ChildProcess,
  signal: 'SIGTERM' | 'SIGKILL'
): void {
  const pid = child.pid;

  if (isWindows) {
    if (signal === 'SIGKILL' && typeof pid === 'number' && pid > 0) {
      try {
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {
          // Exit status intentionally ignored — the tree may already be gone.
        });
        return;
      } catch {
        // taskkill unavailable — fall through to the direct kill.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // Already exited.
    }
    return;
  }

  if (typeof pid === 'number' && pid > 0) {
    try {
      // Negative pid = signal the whole process group the child leads
      // (requires the child to have been spawned with `detached: true`).
      process.kill(-pid, signal);
      return;
    } catch {
      // Group already gone or not a leader — fall back to the direct child.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already exited.
  }
}
