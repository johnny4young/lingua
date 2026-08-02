import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';
import type { GoDebuggerStepCommand } from '../../shared/goDebugger';
import { resolveUserEnvForRunner } from '../runners/env';
import { createNativeDebuggerAdapter } from './nativeDebuggerBridge';

const adapter = createNativeDebuggerAdapter({
  runtime: 'go',
  i18nPrefix: 'goDebugger',
  commandFailedReason: 'command-failed' as const,
  getBridge: () => (typeof window !== 'undefined' ? (window.lingua?.goDebugger ?? null) : null),
  buildStartRequest: (tab, breakpoints, watches) => ({
    tabId: tab.id,
    source: tab.content,
    fileName: tab.name,
    ...(tab.rootId && tab.relativePath
      ? { rootId: asRootId(tab.rootId), relativePath: asRelativePath(tab.relativePath) }
      : {}),
    breakpoints,
    watches,
    userEnv: resolveUserEnvForRunner(),
    ...(tab.inputArgs && tab.inputArgs.length > 0 ? { programArgs: tab.inputArgs } : {}),
  }),
});
export const nativeDebuggerAdapter = adapter;

export const executeGoDebugSession = adapter.execute;
export const isGoDebuggerActive = adapter.isActive;
export const dispatchGoDebuggerCommand = (command: GoDebuggerStepCommand): boolean =>
  adapter.dispatchCommand(command);
export const syncGoDebuggerBreakpoints = adapter.syncBreakpoints;
export const syncGoDebuggerWatches = adapter.syncWatches;
export const runGoDebuggerToEnd = adapter.runToEnd;
export const stopActiveGoDebugger = adapter.stop;
