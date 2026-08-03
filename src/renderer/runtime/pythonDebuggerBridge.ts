import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';
import type { PythonDebuggerStepCommand } from '../../shared/pythonDebugger';
import { resolveUserEnvForRunner } from '../runners/env';
import { createNativeDebuggerAdapter } from './nativeDebuggerBridge';

const adapter = createNativeDebuggerAdapter({
  runtime: 'python',
  i18nPrefix: 'pythonDebugger',
  commandFailedReason: 'command-failed' as const,
  getBridge: () =>
    typeof window !== 'undefined' ? (window.lingua?.pythonDebugger ?? null) : null,
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

export const executePythonDebugSession = adapter.execute;
export const isPythonDebuggerActive = adapter.isActive;
export const dispatchPythonDebuggerCommand = (command: PythonDebuggerStepCommand): boolean =>
  adapter.dispatchCommand(command);
export const syncPythonDebuggerBreakpoints = adapter.syncBreakpoints;
export const syncPythonDebuggerWatches = adapter.syncWatches;
export const runPythonDebuggerToEnd = adapter.runToEnd;
export const stopActivePythonDebugger = adapter.stop;
