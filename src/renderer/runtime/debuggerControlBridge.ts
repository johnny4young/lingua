import { useDebuggerStore } from '../stores/debuggerStore';
import {
  isDebugWorkerActive,
  postDebuggerMessage,
  type DebuggerControlMessage,
} from './debuggerWorkerBridge';
/** Route shared debugger controls to the attached runtime adapter. */
export function dispatchDebuggerControl(message: DebuggerControlMessage): boolean {
  if (useDebuggerStore.getState().session?.runtime !== 'python') {
    return postDebuggerMessage(message);
  }
  void import('./pythonDebuggerBridge')
    .then(adapter => {
      if (message.type === 'resume') {
        adapter.dispatchPythonDebuggerCommand('continue');
        return;
      }
      if (message.type === 'step') {
        adapter.dispatchPythonDebuggerCommand(
          message.mode === 'over' ? 'step-over' : message.mode === 'into' ? 'step-into' : 'step-out'
        );
        return;
      }
      if (message.type === 'set-breakpoints') {
        adapter.syncPythonDebuggerBreakpoints(
          message.breakpoints.map(breakpoint => breakpoint.line)
        );
        return;
      }
      adapter.syncPythonDebuggerWatches(message.watches);
    })
    .catch(() => undefined);
  return true;
}

export function dispatchDebuggerRunToEnd(): boolean {
  if (useDebuggerStore.getState().session?.runtime === 'python') {
    void import('./pythonDebuggerBridge')
      .then(adapter => {
        adapter.runPythonDebuggerToEnd();
      })
      .catch(() => undefined);
    return true;
  }
  const cleared = postDebuggerMessage({ type: 'set-breakpoints', breakpoints: [] });
  const resumed = postDebuggerMessage({ type: 'resume' });
  return cleared || resumed;
}

export function isDebuggerControlActive(): boolean {
  return isDebugWorkerActive() || useDebuggerStore.getState().session?.runtime === 'python';
}

export type { DebuggerControlMessage };
