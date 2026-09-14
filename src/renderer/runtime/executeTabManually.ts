import { runnerManager } from '../runners';
import { useEditorStore } from '../stores/editorStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { FileTab } from '../types/editor';
import { acquireRunner, announceCompilation, startRunnerBootstrap } from './execute/prepareRun';
import {
  publishCancelledRun,
  publishCompletedRun,
  publishFailedRun,
  publishMissingRunner,
  publishRunFailure,
  publishRunStart,
  publishUnsupportedRunner,
  publishValidation,
  publishValidationStart,
  publishViewOnly,
} from './execute/publishRunResult';
import { snapshotGitPosture } from './execute/recordRunHistory';
import { resolveRunExecution, resolveRunPlan } from './execute/resolveRunPlan';
import { createRunConsole, runAndCollect } from './execute/runAndCollect';
import type { ManualExecutionLifecycle, ManualExecutionSummary } from './execute/types';

export type { ManualExecutionLifecycle, ManualExecutionSummary } from './execute/types';

/**
 * Shared manual execution orchestrator for toolbar Run, command-palette run,
 * history replay, desktop smoke, and debug entry points.
 *
 * One run goes through four steps, each in `runtime/execute/`:
 *
 *   1. `resolveRunPlan` decides the mode, debug path, timeout and execution
 *      context without touching state.
 *   2. `prepareRun` shows the runtime bootstrap and gets the runner.
 *   3. `runAndCollect` runs it, streaming output and arming the deadline.
 *   4. `publishRunResult` shows the outcome and records history and telemetry.
 *
 * Every lifecycle callback, console flush and bootstrap outcome is issued
 * here, so each exit's teardown is visible in one function.
 *
 * Keep feature hooks in these steps only when they must observe the exact
 * code string passed to `runner.execute`; otherwise prefer a narrower
 * hook/store module so this path does not become incidental glue.
 */
export async function executeTabManually(
  activeTab: FileTab,
  lifecycle: ManualExecutionLifecycle = {}
): Promise<ManualExecutionSummary> {
  const runConsole = createRunConsole();
  const plan = resolveRunPlan(activeTab, lifecycle);
  const { language } = activeTab;

  lifecycle.setCurrentLanguage?.(language);

  if (plan.mode === 'view') {
    const summary = publishViewOnly(activeTab, runConsole);
    lifecycle.setCurrentLanguage?.(null);
    runConsole.flush();
    return summary;
  }
  if (plan.mode === 'validate') {
    publishValidationStart(activeTab, runConsole);
    lifecycle.setIsRunning?.(true);
    try {
      return publishValidation(activeTab, runConsole);
    } finally {
      runConsole.flush();
      useResultStore.getState().setIsManualRunning(false);
      lifecycle.setIsRunning?.(false);
      lifecycle.setCurrentLanguage?.(null);
    }
  }
  if (!runnerManager.isSupported(language)) {
    const summary = publishUnsupportedRunner(language, runConsole);
    lifecycle.setCurrentLanguage?.(null);
    runConsole.flush();
    return summary;
  }

  publishRunStart(activeTab, plan, runConsole);
  lifecycle.setIsRunning?.(true);
  const bootstrap = startRunnerBootstrap(activeTab, plan, lifecycle, runConsole);
  let runnerPrepared = false;
  // implementation note — snapshot the git posture at run START, before
  // runner preparation can await. The same value is reused on the outer throw
  // path so a long failed prepare / execute cannot capture a later
  // sibling-terminal checkout instead.
  const gitSnapshot = snapshotGitPosture();

  try {
    const runner = await acquireRunner(activeTab, plan, lifecycle);
    if (!runner) {
      bootstrap.fail();
      return publishMissingRunner(language, runConsole);
    }
    runnerPrepared = true;
    bootstrap.complete();
    announceCompilation(language, lifecycle, runConsole);

    const execution = resolveRunExecution(activeTab, plan, lifecycle, useSettingsStore.getState());
    // Consume the one-shot tab override immediately so a subsequent run
    // reverts to the persisted preset (or to a fresh magic comment if the
    // buffer still carries one).
    if (execution.clearsTimeoutOverride) {
      useEditorStore.getState().setTabNextRunTimeoutOverride(activeTab.id, null);
    }

    const run = await runAndCollect(runner, activeTab, execution, runConsole);
    if (run.result.cancelled) {
      return publishCancelledRun(activeTab, run, runConsole);
    }
    return await publishCompletedRun(activeTab, plan, run, gitSnapshot, runConsole);
  } catch (error) {
    const message = await publishRunFailure(activeTab, plan, error, gitSnapshot);
    if (!runnerPrepared) {
      bootstrap.fail();
    }
    return publishFailedRun(language, message, runnerPrepared, runConsole);
  } finally {
    runConsole.flush();
    useResultStore.getState().setIsManualRunning(false);
    lifecycle.setIsRunning?.(false);
    lifecycle.setIsInitializing?.(false);
    lifecycle.setLoadingMessage?.(null);
    lifecycle.setCurrentLanguage?.(null);
  }
}
