/**
 * Process-env snapshot IPC handler (RL-011 Slice B).
 *
 * The renderer needs a read-only snapshot of the host `process.env` so the
 * env-var scope merger can resolve the `processEnv` tier at execute time.
 * Web builds ship a stub that returns `{}` — no host environment exists in
 * the browser sandbox.
 *
 * The payload is **filtered to string values only** so accidental binary
 * junk in the env (rare but possible on some shells) can't poison the
 * merged record. Reserved host-critical names are intentionally left in
 * the snapshot: the merger's own validator will skip them on the way into
 * the merged output.
 */

import { ipcMain } from 'electron';

export function snapshotProcessEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function registerEnvHandlers(): void {
  ipcMain.handle('env:snapshot', () => snapshotProcessEnv());
}
