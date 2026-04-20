/**
 * Process-env snapshot IPC handler (RL-011 Slice B).
 *
 * Important boundary: the renderer must NOT receive the host `process.env`
 * wholesale. It may contain credentials, tokens, and machine-specific
 * values that have no place in a renderer-visible API. The actual
 * child-process merge (`process.env` + global/project/tab overrides) belongs
 * in main once runner integration lands.
 *
 * For now we keep the bridge shape stable and return an empty record on both
 * desktop and web. That preserves the store contract without leaking host
 * secrets across the preload boundary.
 */

import { ipcMain } from 'electron';

export function snapshotProcessEnv(): Record<string, string> {
  return {};
}

export function registerEnvHandlers(): void {
  ipcMain.handle('env:snapshot', () => snapshotProcessEnv());
}
