/**
 * Getting a runner ready for one manual run: the initialization message and
 * live bootstrap progress while a runtime boots, the runner itself (or a
 * native debugger session for Python, Go and Rust Debug runs), and the
 * compilation notice for compiled languages.
 */

import { trackEvent } from '../../utils/telemetry';
import { bucketBootDuration } from '../../../shared/telemetry';
import { runnerManager } from '../../runners';
import {
  formatBootstrapProgress,
  useBootstrapProgressStore,
} from '../../stores/bootstrapProgressStore';
import {
  getCompilationLoadingMessage,
  getCompilationMessage,
  getInitializationMessage,
} from '../../hooks/runnerOutput';
import type { FileTab } from '../../types/editor';
import type { ExecutionContext, LanguageRunner } from '../../types/execution';
import type { Language } from '../../types/language';
import type { RunPlan } from './resolveRunPlan';
import type { RunConsole } from './runAndCollect';
import type { ManualExecutionLifecycle } from './types';

export interface RunnerBootstrap {
  dispose: () => void;
  /** The runner is ready; emits the completed outcome when a boot was shown. */
  complete: () => void;
  /** Preparation failed; emits the failed outcome when a boot was shown. */
  fail: () => void;
}

type RuntimeBootstrapOutcome = { kind: 'completed'; durationMs: number } | { kind: 'failed' };

/** Emit one closed bootstrap outcome without growing direct telemetry calls. */
function trackRuntimeBootstrapOutcome(language: Language, outcome: RuntimeBootstrapOutcome): void {
  const event =
    outcome.kind === 'completed' ? 'runtime.bootstrap_completed' : 'runtime.bootstrap_failed';
  const properties: Record<string, string | number | boolean> =
    outcome.kind === 'completed'
      ? {
          language,
          durationBucket: bucketBootDuration(outcome.durationMs),
        }
      : { language, reason: 'prepare-error' };
  void trackEvent(event, properties);
}

export function startRunnerBootstrap(
  activeTab: FileTab,
  plan: RunPlan,
  lifecycle: ManualExecutionLifecycle,
  runConsole: RunConsole
): RunnerBootstrap {
  const { language, runtimeMode } = activeTab;
  const shouldShowInitialization =
    !plan.usesNativeDebugger && runnerManager.needsInitialization(language, runtimeMode);
  // internal — while the runtime bootstraps, compose the live download
  // progress the worker streams into the static loading message
  // ("Loading Python runtime (Pyodide)... 34 MB / 60 MB"). The
  // subscription lives exactly as long as the initialization window.
  let unsubscribeBootstrapProgress: (() => void) | undefined;
  const bootstrapStartedAt = performance.now();
  let bootstrapSettled = false;
  if (shouldShowInitialization) {
    lifecycle.setIsInitializing?.(true);
    const message = getInitializationMessage(language);
    lifecycle.setLoadingMessage?.(message);
    runConsole.add({ type: 'info', content: message });
    useBootstrapProgressStore.getState().clear();
    unsubscribeBootstrapProgress = useBootstrapProgressStore.subscribe(state => {
      if (state.progress && state.progress.language === language) {
        lifecycle.setLoadingMessage?.(formatBootstrapProgress(message, state.progress));
      }
    });
  }
  const dispose = () => {
    unsubscribeBootstrapProgress?.();
    unsubscribeBootstrapProgress = undefined;
  };
  const unregisterCancel = lifecycle.session?.onCancel(dispose);
  const settle = (outcome: RuntimeBootstrapOutcome) => {
    if (!shouldShowInitialization || bootstrapSettled) return;
    bootstrapSettled = true;
    unsubscribeBootstrapProgress?.();
    unsubscribeBootstrapProgress = undefined;
    if (lifecycle.session && !lifecycle.session.isCurrent()) return;
    useBootstrapProgressStore.getState().clear(language);
    lifecycle.setIsInitializing?.(false);
    lifecycle.setLoadingMessage?.(null);
    trackRuntimeBootstrapOutcome(language, outcome);
  };

  return {
    dispose: () => {
      dispose();
      unregisterCancel?.();
    },
    complete: () => {
      if (!shouldShowInitialization) return;
      // internal — bucketed adoption signal; exact durations stay local.
      settle({ kind: 'completed', durationMs: performance.now() - bootstrapStartedAt });
    },
    // Closed-enum failure signal; the console entry carries the honest local message.
    fail: () => settle({ kind: 'failed' }),
  };
}

/** Resolves the runner for this run, or null when the manager has none for the language. */
export async function acquireRunner(
  activeTab: FileTab,
  plan: RunPlan,
  lifecycle: ManualExecutionLifecycle
): Promise<Pick<LanguageRunner, 'execute'> | null> {
  if (plan.usesNativeDebugger) {
    return nativeDebuggerRunner(activeTab, lifecycle);
  }
  const { runner } = await runnerManager.prepareRunner(activeTab.language, activeTab.runtimeMode);
  return runner;
}

function nativeDebuggerRunner(
  activeTab: FileTab,
  lifecycle: ManualExecutionLifecycle
): Pick<LanguageRunner, 'execute'> {
  const { language } = activeTab;
  return {
    execute: async (_source: string, context?: ExecutionContext) => {
      if (language === 'python') {
        const { executePythonDebugSession, stopActivePythonDebugger } =
          await import('../pythonDebuggerBridge');
        if (lifecycle.session && !lifecycle.session.isCurrent()) return cancelledResult();
        const unregister = lifecycle.session?.onCancel(stopActivePythonDebugger);
        try {
          return await executePythonDebugSession(activeTab, context?.onConsole, lifecycle.track);
        } finally {
          unregister?.();
        }
      }
      if (language === 'go') {
        const { executeGoDebugSession, stopActiveGoDebugger } = await import('../goDebuggerBridge');
        if (lifecycle.session && !lifecycle.session.isCurrent()) return cancelledResult();
        const unregister = lifecycle.session?.onCancel(stopActiveGoDebugger);
        try {
          return await executeGoDebugSession(activeTab, context?.onConsole, lifecycle.track);
        } finally {
          unregister?.();
        }
      }
      const { executeRustDebugSession, stopActiveRustDebugger } =
        await import('../rustDebuggerBridge');
      if (lifecycle.session && !lifecycle.session.isCurrent()) return cancelledResult();
      const unregister = lifecycle.session?.onCancel(stopActiveRustDebugger);
      try {
        return await executeRustDebugSession(activeTab, context?.onConsole, lifecycle.track);
      } finally {
        unregister?.();
      }
    },
  };
}

export function announceCompilation(
  language: Language,
  lifecycle: ManualExecutionLifecycle,
  runConsole: RunConsole
): void {
  const compilationLoadingMessage = getCompilationLoadingMessage(language);
  const compilationMessage = getCompilationMessage(language);
  if (compilationLoadingMessage && compilationMessage) {
    lifecycle.setLoadingMessage?.(compilationLoadingMessage);
    runConsole.add(compilationMessage);
  }
}

function cancelledResult() {
  return { stdout: [], stderr: [], executionTime: 0, cancelled: true };
}
