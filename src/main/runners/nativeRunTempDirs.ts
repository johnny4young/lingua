import { mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Source and compiled artifacts staged by the main-process native runners. */
const active = new Set<string>();

export function stageNativeRunTempDir(prefix: string): string {
  if (!/^lingua-[a-z-]+-$/.test(prefix)) throw new Error('Invalid native staging prefix');
  // Creation and registration must be one synchronous turn. An async mkdtemp
  // can finish after Electron's non-awaiting before-quit listener has returned.
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  active.add(dir);
  return dir;
}

export async function cleanupNativeRunTempDir(dir: string): Promise<void> {
  if (!active.has(dir)) return;
  try {
    await rm(dir, { recursive: true, force: true });
    active.delete(dir);
  } catch {
    // Retain ownership so shutdown can retry synchronously.
  }
}

/** before-quit cannot await asynchronous runner finally blocks. */
export function disposeNativeRunTempDirs(): void {
  for (const dir of active) {
    try {
      rmSync(dir, { recursive: true, force: true });
      active.delete(dir);
    } catch {
      // Best effort when another process still holds a file, notably Windows.
    }
  }
}
