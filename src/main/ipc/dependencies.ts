/**
 * RL-025 Slice A - IPC handler for JS / TS dependency resolution.
 *
 * Single channel `dependencies:js:resolve` accepts a batch of
 * specifiers plus the active tab's `filePath` and returns a per-name
 * status record. No installation, no spawn - that lands in Slice B.
 */

import { ipcMain } from 'electron';
import {
  resolveJsDependencyBatch,
  type DependencyResolveResult,
} from '../dependencies';

export function registerDependencyHandlers(): void {
  ipcMain.handle(
    'dependencies:js:resolve',
    async (
      _event,
      rawSpecifiers: unknown,
      rawFilePath: unknown
    ): Promise<DependencyResolveResult> => {
      const specifiers = Array.isArray(rawSpecifiers) ? rawSpecifiers : [];
      const filePath =
        typeof rawFilePath === 'string' ? rawFilePath : undefined;
      return resolveJsDependencyBatch(specifiers, filePath);
    }
  );
}
