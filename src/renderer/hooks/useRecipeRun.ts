/**
 * implementation — `useRecipeRun` hook.
 *
 * Orchestrates the Run + Test flow when a tab is bound to a recipe:
 *
 *   1. Resolve the active tab + its recipe binding.
 *   2. Read the tab's CURRENT source via `useEditorStore`.
 *   3. Compose the language-aware assertion source via
 *      `buildLessonRunSource` (no tab content mutation — the user
 *      keeps their working code intact).
 *   4. Invoke `runnerManager.execute(recipe.language, source)` directly.
 *      We BYPASS `useRunner` / `executeTabManually` on purpose:
 *        - Assertion runs should NOT pollute the user's execution
 *          history (Recent Runs popover, capsule snapshot).
 *        - Assertion runs should NOT overwrite the Result panel
 *          with the sentinel-prefixed lines.
 *        - License + native-execution gates do not apply (the bundled
 *          JS/TS/Python web runners are Free + local).
 *      The shared manual-running flag is still held while the worker is
 *      leased. That makes a pending auto-run stand down and lets the
 *      runner preempt an already-started auto-run without a later debounce
 *      cancelling the assertion execution.
 *   5. Parse `result.stdout` for sentinel-prefixed JSON lines via
 *      `parseAssertionResults`.
 *   6. Roll up to a closed-enum `RecipeRunStatus`, update the
 *      `recipeStore`, persist progress via `lessonProgressStore`,
 *      and fire the `recipe.test_run` telemetry event.
 *
 * The hook is intentionally thin — most logic lives in the shared
 * `lessonRunner` helpers so the upcoming `lingua lesson validate`
 * CLI  can reuse the same composition + parse path.
 */

import { useCallback } from 'react';
import { runnerManager } from '../runners';
import {
  ASSERTION_RESULT_SENTINEL,
  buildLessonRunSource,
  isRecipeRunnableLanguage,
  parseAssertionResults,
  rollupRunStatus,
  type AssertionRunResult,
  type RecipeRunStatus,
} from '../../shared/lessonRunner';
import { getRecipeById } from '../data/recipes';
import { useEditorStore } from '../stores/editorStore';
import { useLessonProgressStore } from '../stores/lessonProgressStore';
import { useRecipeStore } from '../stores/recipeStore';
import { useResultStore } from '../stores/resultStore';
import { useUIStore } from '../stores/uiStore';
import { trackRecipeTestRun } from './recipeTelemetry';

export interface RecipeRunOutcome {
  readonly status: RecipeRunStatus;
  readonly results: ReadonlyArray<AssertionRunResult>;
}

export interface UseRecipeRunResult {
  /** Execute Run + Test for the active tab's bound recipe. */
  runActiveTab: () => Promise<RecipeRunOutcome | null>;
  /** Drop the binding + clear results for the active tab. */
  unbindActiveTab: () => void;
}

export function useRecipeRun(): UseRecipeRunResult {
  const runActiveTab = useCallback(async (): Promise<RecipeRunOutcome | null> => {
    const editor = useEditorStore.getState();
    const tabId = editor.activeTabId;
    if (!tabId) return null;
    const tab = editor.tabs.find((entry) => entry.id === tabId);
    if (!tab) return null;
    const recipeStore = useRecipeStore.getState();
    const recipeId = tab.recipeBindingId;
    if (!recipeId) return null;
    const recipe = getRecipeById(recipeId);
    if (!recipe) {
      // Orphan binding (recipe removed from the catalog) — clean it up.
      recipeStore.unbindRecipe(tabId);
      editor.clearRecipeBinding(tabId);
      return null;
    }
    if (
      !isRecipeRunnableLanguage(tab.language) ||
      !isRecipeRunnableLanguage(recipe.language) ||
      tab.language !== recipe.language
    ) {
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'recipes.notice.disabledForLanguageMismatch',
      });
      return null;
    }

    const resultStore = useResultStore.getState();
    if (recipeStore.isTabRunning(tabId) || resultStore.isManualRunning) {
      return null;
    }

    recipeStore.setRunning(tabId, true);
    // A recipe run is a user-triggered worker lease even though it does not
    // publish to the Result panel. Reuse the established manual-run mutex so
    // useAutoRun cannot start a competing execution after an editor change.
    resultStore.setIsManualRunning(true);
    try {
      const composed = buildLessonRunSource(
        recipe.language,
        tab.content,
        recipe.assertions
      );
      const result = await runnerManager.execute(recipe.language, composed, {
        language: recipe.language,
        // No filePath, no env — recipes run as pure scratchpad code.
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      const stdoutText = flattenStdoutForSentinel(result.stdout);
      const stderrText = flattenStdoutForSentinel(result.stderr);
      const combined = stderrText ? `${stdoutText}\n${stderrText}` : stdoutText;
      const results = parseAssertionResults(combined, recipe.assertions);
      // Pyodide can surface a source parse failure only through stderr while
      // still resolving the worker envelope. Do not collapse that useful
      // diagnostic into anonymous sentinel-missing rows.
      if (results.every((entry) => entry.status === 'sentinel-missing')) {
        const stderrDetail = lastConsoleDetail(result.stderr);
        if (stderrDetail) throw new Error(stderrDetail);
      }
      const status = rollupRunStatus(results);
      recipeStore.setRunResults(tabId, results);
      const passed = results.filter((r) => r.status === 'pass').length;
      useLessonProgressStore.getState().recordRun(recipe.id, {
        passed,
        total: results.length,
      });
      trackRecipeTestRun({ language: recipe.language, status });
      return { status, results };
    } catch (err) {
      // Runner-level throw — surface one diagnostic row per assertion.
      const message = err instanceof Error ? err.message : String(err);
      const fallback: AssertionRunResult[] = recipe.assertions.map((a) => ({
        assertionId: a.id,
        status: 'sentinel-missing' as const,
        details: clipForDetail(message),
      }));
      recipeStore.setRunResults(tabId, fallback);
      useLessonProgressStore.getState().recordRun(recipe.id, {
        passed: 0,
        total: fallback.length,
      });
      trackRecipeTestRun({
        language: recipe.language,
        status: 'execution-error',
      });
      return { status: 'execution-error', results: fallback };
    } finally {
      resultStore.setIsManualRunning(false);
      recipeStore.setRunning(tabId, false);
    }
  }, []);

  const unbindActiveTab = useCallback(() => {
    const editor = useEditorStore.getState();
    const tabId = editor.activeTabId;
    if (!tabId) return;
    editor.clearRecipeBinding(tabId);
  }, []);

  return { runActiveTab, unbindActiveTab };
}

/**
 * Flatten an array of `ConsoleOutput` entries (the runner's
 * `result.stdout` shape) into a single newline-joined string
 * suitable for `parseAssertionResults`. We keep ONLY the args[0]
 * slot of each entry — that's where `console.log(SENTINEL + JSON)`
 * lands. Multi-arg `console.log(...)` calls in the user's code put
 * additional args at args[1+], but those never carry the sentinel
 * (only the composed assertion shim emits it, and the shim only
 * passes one string arg).
 */
function flattenStdoutForSentinel(
  entries: ReadonlyArray<{ args: string[] }>
): string {
  const lines: string[] = [];
  for (const entry of entries) {
    const first = entry.args[0];
    if (typeof first !== 'string') continue;
    // Fast filter — only keep lines that include the sentinel. This
    // avoids paying parse cost on every user `console.log`.
    if (!first.includes(ASSERTION_RESULT_SENTINEL)) continue;
    lines.push(first);
  }
  return lines.join('\n');
}

function clipForDetail(text: string): string {
  const MAX = 200;
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
}

function lastConsoleDetail(
  entries: ReadonlyArray<{ args: ReadonlyArray<string> }>
): string | null {
  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const args = entries[entryIndex]?.args ?? [];
    for (let argIndex = args.length - 1; argIndex >= 0; argIndex -= 1) {
      const text = args[argIndex]?.trim();
      if (text) return text;
    }
  }
  return null;
}
