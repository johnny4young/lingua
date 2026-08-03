import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';
import type { RustDebuggerStepCommand } from '../../shared/rustDebugger';
import { resolveUserEnvForRunner } from '../runners/env';
import { createNativeDebuggerAdapter } from './nativeDebuggerBridge';

const adapter = createNativeDebuggerAdapter({
  runtime: 'rust',
  i18nPrefix: 'rustDebugger',
  commandFailedReason: 'command-failed' as const,
  getBridge: () => (typeof window !== 'undefined' ? (window.lingua?.rustDebugger ?? null) : null),
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
export const executeRustDebugSession = adapter.execute;
export const isRustDebuggerActive = adapter.isActive;
export const dispatchRustDebuggerCommand = (command: RustDebuggerStepCommand): boolean =>
  adapter.dispatchCommand(command);
export const syncRustDebuggerBreakpoints = adapter.syncBreakpoints;
export const syncRustDebuggerWatches = adapter.syncWatches;
export const runRustDebuggerToEnd = adapter.runToEnd;
export const stopActiveRustDebugger = adapter.stop;
