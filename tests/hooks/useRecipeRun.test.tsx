/**
 * RL-039 Slice C — language-aware Run + Test orchestration.
 *
 * The worker implementations have their own suites and real web E2E. These
 * cases pin the renderer seam: recipe language selects the runner/composer,
 * progress + telemetry receive that language, execution errors do not degrade
 * into sentinel-missing, and a stale cross-language binding never executes.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecipeRun } from '../../src/renderer/hooks/useRecipeRun';
import { getRecipeById } from '../../src/renderer/data/recipes';
import {
  createDefaultTab,
  useEditorStore,
} from '../../src/renderer/stores/editorStore';
import {
  resetLessonProgressStoreForTests,
  useLessonProgressStore,
} from '../../src/renderer/stores/lessonProgressStore';
import {
  resetRecipeStoreForTests,
  useRecipeStore,
} from '../../src/renderer/stores/recipeStore';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { ASSERTION_RESULT_SENTINEL } from '../../src/shared/lessonRunner';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  trackRecipeTestRun: vi.fn(),
}));

vi.mock('../../src/renderer/runners', () => ({
  runnerManager: { execute: mocks.execute },
}));

vi.mock('../../src/renderer/hooks/recipeTelemetry', () => ({
  trackRecipeTestRun: mocks.trackRecipeTestRun,
}));

function bindRecipeTab(recipeId: string, tabLanguage?: 'javascript' | 'typescript' | 'python') {
  const recipe = getRecipeById(recipeId);
  if (!recipe) throw new Error(`missing fixture recipe ${recipeId}`);
  const language = tabLanguage ?? recipe.language;
  if (
    language !== 'javascript' &&
    language !== 'typescript' &&
    language !== 'python'
  ) {
    throw new Error(`unsupported test language ${language}`);
  }
  const tab = {
    ...createDefaultTab(language),
    content:
      language === 'python'
        ? 'def answer():\n    return 42'
        : 'const answer: number = 42;',
    recipeBindingId: recipe.id,
  };
  useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
  useRecipeStore.getState().bindRecipeToTab(tab.id, recipe.id);
  return { recipe, tab };
}

function passingExecutionResult(recipeId: string) {
  const recipe = getRecipeById(recipeId);
  if (!recipe) throw new Error(`missing fixture recipe ${recipeId}`);
  return {
    stdout: recipe.assertions.map((assertion) => ({
      type: 'log' as const,
      args: [
        `${ASSERTION_RESULT_SENTINEL}${JSON.stringify({
          assertionId: assertion.id,
          status: 'pass',
        })}`,
      ],
    })),
    stderr: [],
    result: undefined,
    executionTime: 1,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  resetRecipeStoreForTests();
  resetLessonProgressStoreForTests();
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useResultStore.setState({ isManualRunning: false, isAutoRunning: false });
  useUIStore.setState({ statusNotice: null });
});

describe('useRecipeRun', () => {
  it.each([
    ['ts-generic-key-by', 'typescript', 'const answer: number = 42;'],
    ['py-word-frequency', 'python', 'import json as __lingua_recipe_json'],
  ] as const)(
    'dispatches %s through the %s runner and records passed progress',
    async (recipeId, language, sourceNeedle) => {
      const { recipe } = bindRecipeTab(recipeId);
      mocks.execute.mockResolvedValue(passingExecutionResult(recipeId));
      const { result } = renderHook(() => useRecipeRun());

      let outcome: Awaited<ReturnType<typeof result.current.runActiveTab>> = null;
      await act(async () => {
        outcome = await result.current.runActiveTab();
      });

      expect(outcome?.status).toBe('all-passed');
      expect(useResultStore.getState().isManualRunning).toBe(false);
      expect(mocks.execute).toHaveBeenCalledWith(
        language,
        expect.stringContaining(sourceNeedle),
        { language }
      );
      expect(mocks.trackRecipeTestRun).toHaveBeenCalledWith({
        language,
        status: 'all-passed',
      });
      expect(useLessonProgressStore.getState().getEntry(recipe.id)).toMatchObject({
        status: 'passed',
        lastResult: {
          passed: recipe.assertions.length,
          total: recipe.assertions.length,
        },
      });
    }
  );

  it('maps a resolved runner error to execution-error with details', async () => {
    const { recipe } = bindRecipeTab('ts-generic-key-by');
    mocks.execute.mockResolvedValue({
      stdout: [],
      stderr: [],
      result: undefined,
      executionTime: 0,
      error: { message: 'TypeScript transpilation error: unexpected token' },
    });
    const { result } = renderHook(() => useRecipeRun());

    let outcome: Awaited<ReturnType<typeof result.current.runActiveTab>> = null;
    await act(async () => {
      outcome = await result.current.runActiveTab();
    });

    expect(outcome?.status).toBe('execution-error');
    expect(outcome?.results).toHaveLength(recipe.assertions.length);
    expect(outcome?.results[0]).toMatchObject({
      status: 'sentinel-missing',
      details: 'TypeScript transpilation error: unexpected token',
    });
    expect(mocks.trackRecipeTestRun).toHaveBeenCalledWith({
      language: 'typescript',
      status: 'execution-error',
    });
  });

  it('promotes stderr-only worker failures to execution-error details', async () => {
    const { recipe } = bindRecipeTab('py-word-frequency');
    mocks.execute.mockResolvedValue({
      stdout: [],
      stderr: [
        { type: 'error', args: ['Traceback (most recent call last):'] },
        { type: 'error', args: ['IndentationError: unexpected indent'] },
      ],
      result: undefined,
      executionTime: 1,
      kind: 'success',
    });
    const { result } = renderHook(() => useRecipeRun());

    let outcome: Awaited<ReturnType<typeof result.current.runActiveTab>> = null;
    await act(async () => {
      outcome = await result.current.runActiveTab();
    });

    expect(outcome?.status).toBe('execution-error');
    expect(outcome?.results).toHaveLength(recipe.assertions.length);
    expect(outcome?.results[0]).toMatchObject({
      status: 'sentinel-missing',
      details: 'IndentationError: unexpected indent',
    });
  });

  it('holds the manual-run mutex while executing and releases it afterward', async () => {
    bindRecipeTab('py-word-frequency');
    mocks.execute.mockImplementation(async () => {
      expect(useResultStore.getState().isManualRunning).toBe(true);
      return passingExecutionResult('py-word-frequency');
    });
    const { result } = renderHook(() => useRecipeRun());

    await act(async () => {
      await result.current.runActiveTab();
    });

    expect(useResultStore.getState().isManualRunning).toBe(false);
  });

  it('does not interrupt an existing manual execution', async () => {
    bindRecipeTab('ts-generic-key-by');
    useResultStore.setState({ isManualRunning: true });
    const { result } = renderHook(() => useRecipeRun());

    let outcome: Awaited<ReturnType<typeof result.current.runActiveTab>> = null;
    await act(async () => {
      outcome = await result.current.runActiveTab();
    });

    expect(outcome).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(useRecipeStore.getState().isRunning.size).toBe(0);
  });

  it('refuses a stale cross-language binding before runner dispatch', async () => {
    bindRecipeTab('ts-generic-key-by', 'python');
    const { result } = renderHook(() => useRecipeRun());

    let outcome: Awaited<ReturnType<typeof result.current.runActiveTab>> = null;
    await act(async () => {
      outcome = await result.current.runActiveTab();
    });

    expect(outcome).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'recipes.notice.disabledForLanguageMismatch',
    });
  });
});
