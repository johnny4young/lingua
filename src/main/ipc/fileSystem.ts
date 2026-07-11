/**
 * File system IPC assembly for the Electron main process.
 *
 * RL-077 capability enforcement remains inside each focused handler group.
 * This module only installs the protected-path denylist and composes approvals,
 * core operations, search/replace, bundles, and watcher lifecycle handlers.
 */

import { app } from 'electron';
import { registerBlockedPaths } from './permissions';
import { registerFileOperationHandlers } from './fs/fsOperations';
import { registerWatcherHandlers } from './fs/fsWatchers';

export {
  _resetFilesystemApprovalsForTests,
  pathInsideApprovedScope,
  pathIntersectsApprovedScope,
} from './fs/fsApprovals';
export {
  _resetBeforeQuitInstallStateForTests,
  _resetWatcherBurstTrackerForTests,
  stopAllWatchers,
} from './fs/fsWatchers';

export function registerFileSystemHandlers(): void {
  // RL-137 / AUDIT-17 — resolve Electron-owned data dirs from the live app so
  // the defense-in-depth denylist follows the actual platform paths.
  registerBlockedPaths(
    (['userData', 'sessionData', 'logs'] as const).flatMap((name) => {
      try {
        return [app.getPath(name)];
      } catch {
        return [];
      }
    })
  );

  registerFileOperationHandlers();
  registerWatcherHandlers();
}
