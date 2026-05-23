/**
 * RL-102 Slice 1 — IPC handlers for the Git read-only layer.
 *
 * Three channels:
 *
 *   - `git:detect` accepts a folder path and returns
 *     `{ installed, version?, repoRoot?, branch? }`. Renderer calls
 *     this once per project root change.
 *   - `git:status` accepts `repoRoot` + `filePath` and returns the
 *     porcelain status bucket + numstat counts. Watcher-driven; the
 *     renderer debounces to keep the spawn rate sane.
 *   - `git:diff` accepts `repoRoot` + `filePath` and returns both
 *     diff sides as strings (Monaco diff editor input).
 *
 * Input validation lives in `src/main/git.ts` (path-traversal guard
 * via `validateRepoRelativePath`); this module is a thin marshaling
 * layer that only normalizes the raw IPC tuple into typed arguments.
 *
 * Slice 1 is read-only. There is no write surface; a future slice
 * with `git:add` / `git:commit` would register here too, behind an
 * explicit feature gate.
 */

import { ipcMain } from 'electron';
import {
  detectGit,
  getFileDiff,
  getFileStatus,
  type GitDetectResult,
  type GitFileDiff,
  type GitFileStatus,
} from '../git';

export function registerGitHandlers(): void {
  ipcMain.handle(
    'git:detect',
    async (_event, rawFolderPath: unknown): Promise<GitDetectResult> => {
      const folderPath =
        typeof rawFolderPath === 'string' && rawFolderPath.length > 0
          ? rawFolderPath
          : undefined;
      return detectGit(folderPath);
    }
  );

  ipcMain.handle(
    'git:status',
    async (
      _event,
      rawRepoRoot: unknown,
      rawFilePath: unknown
    ): Promise<GitFileStatus> => {
      if (typeof rawRepoRoot !== 'string' || rawRepoRoot.length === 0) {
        return { status: 'unknown' };
      }
      if (typeof rawFilePath !== 'string' || rawFilePath.length === 0) {
        return { status: 'unknown' };
      }
      return getFileStatus(rawRepoRoot, rawFilePath);
    }
  );

  ipcMain.handle(
    'git:diff',
    async (
      _event,
      rawRepoRoot: unknown,
      rawFilePath: unknown
    ): Promise<GitFileDiff> => {
      if (typeof rawRepoRoot !== 'string' || rawRepoRoot.length === 0) {
        return { originalContent: '', modifiedContent: '', truncated: false };
      }
      if (typeof rawFilePath !== 'string' || rawFilePath.length === 0) {
        return { originalContent: '', modifiedContent: '', truncated: false };
      }
      return getFileDiff(rawRepoRoot, rawFilePath);
    }
  );
}
