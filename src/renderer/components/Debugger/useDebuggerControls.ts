import { useDebuggerStore } from '../../stores/debuggerStore';
import {
  dispatchDebuggerControl,
  dispatchDebuggerRunToEnd,
} from '../../runtime/debuggerControlBridge';
import { useTelemetry } from '../../hooks/useTelemetry';

/** The paused frame and the step actions shared by the Debugger tab and the step HUD. */
export function useDebuggerControls() {
  const { track } = useTelemetry();
  const session = useDebuggerStore((state) => state.session);
  const pausedFrame = useDebuggerStore((state) => state.pausedFrame);
  const isPaused = pausedFrame !== null;
  // Some runtimes can pause without stack metadata; do not expose a
  // step-out action that the worker cannot satisfy.
  const canStepOut =
    isPaused &&
    pausedFrame.callStack.length > 0 &&
    !(session?.runtime === 'python' && pausedFrame.callStack[0]?.functionName === '<module>');

  const resume = () => {
    dispatchDebuggerControl({ type: 'resume' });
    // Optimistically clear the pause state so stale variables/callstack
    // are not shown while the worker resumes execution.
    useDebuggerStore.getState().setPausedFrame(null);
  };
  const step = (mode: 'over' | 'into' | 'out') => {
    dispatchDebuggerControl({ type: 'step', mode });
    // A step command immediately invalidates the current frame; the
    // worker will publish a fresh pause frame if execution stops again.
    useDebuggerStore.getState().setPausedFrame(null);
  };
  const runToEnd = () => {
    // The runners emit their own run-complete / crash / stop reasons; this
    // covers the explicit user-initiated detach.
    const language = session?.runtime ?? 'js';
    if (language !== 'python') {
      track('debugger.detached', { language, reasonBucket: 'user-detach' });
    }
    dispatchDebuggerRunToEnd();
    useDebuggerStore.getState().setPausedFrame(null);
    useDebuggerStore.getState().detachSession();
  };

  return { session, pausedFrame, isPaused, canStepOut, resume, step, runToEnd };
}
