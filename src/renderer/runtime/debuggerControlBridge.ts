import { useDebuggerStore } from '../stores/debuggerStore';
import {
  isDebugWorkerActive,
  postDebuggerMessage,
  type DebuggerControlMessage,
} from './debuggerWorkerBridge';
/** Route shared debugger controls to the attached runtime adapter. */
export function dispatchDebuggerControl(message: DebuggerControlMessage): boolean {
  const runtime = useDebuggerStore.getState().session?.runtime;
  if (runtime !== 'python' && runtime !== 'go') {
    return postDebuggerMessage(message);
  }
  const loadAdapter =
    runtime === 'python' ? import('./pythonDebuggerBridge') : import('./goDebuggerBridge');
  void loadAdapter
    .then(adapter => {
      if (message.type === 'resume') {
        adapter.nativeDebuggerAdapter.dispatchCommand('continue');
        return;
      }
      if (message.type === 'step') {
        const command =
          message.mode === 'over'
            ? 'step-over'
            : message.mode === 'into'
              ? 'step-into'
              : 'step-out';
        adapter.nativeDebuggerAdapter.dispatchCommand(command);
        return;
      }
      if (message.type === 'set-breakpoints') {
        const lines = message.breakpoints.map(breakpoint => breakpoint.line);
        adapter.nativeDebuggerAdapter.syncBreakpoints(lines);
        return;
      }
      adapter.nativeDebuggerAdapter.syncWatches(message.watches);
    })
    .catch(() => undefined);
  return true;
}

export function dispatchDebuggerRunToEnd(): boolean {
  const runtime = useDebuggerStore.getState().session?.runtime;
  if (runtime === 'python' || runtime === 'go') {
    const loadAdapter =
      runtime === 'python' ? import('./pythonDebuggerBridge') : import('./goDebuggerBridge');
    void loadAdapter
      .then(adapter => {
        adapter.nativeDebuggerAdapter.runToEnd();
      })
      .catch(() => undefined);
    return true;
  }
  const cleared = postDebuggerMessage({ type: 'set-breakpoints', breakpoints: [] });
  const resumed = postDebuggerMessage({ type: 'resume' });
  return cleared || resumed;
}

export function isDebuggerControlActive(): boolean {
  const runtime = useDebuggerStore.getState().session?.runtime;
  return isDebugWorkerActive() || runtime === 'python' || runtime === 'go';
}

export type { DebuggerControlMessage };
