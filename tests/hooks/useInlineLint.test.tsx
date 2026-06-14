import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Monaco, OnMount } from '@monaco-editor/react';
import { useInlineLint } from '@/hooks/useInlineLint';
import { LINGUA_LINT_MARKER_OWNER } from '@/lint/lintQuickFixProvider';
import { useSettingsStore } from '@/stores/settingsStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

const initialSettingsState = useSettingsStore.getState();

const activeTab = {
  id: 'tab-1',
  language: 'javascript',
  content: 'if (a == b) {\n  console.log(a)\n}',
};

function setVisibilityState(value: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  });
}

function createHarness() {
  const model = { uri: { toString: () => 'inmemory://model/inline-lint.js' } };
  const editor = {
    getModel: () => model,
  } as unknown as Parameters<OnMount>[0];
  const setModelMarkers = vi.fn();
  const monaco = {
    MarkerSeverity: {
      Error: 8,
      Warning: 4,
      Info: 2,
    },
    editor: {
      setModelMarkers,
      getModelMarkers: vi.fn(() => []),
    },
    languages: {
      registerCodeActionProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
  } as unknown as Monaco;

  return { editor, model, monaco, setModelMarkers };
}

describe('useInlineLint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibilityState('visible');
    useSettingsStore.setState(initialSettingsState, true);
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibilityState('visible');
    useSettingsStore.setState(initialSettingsState, true);
  });

  it('pauses custom marker scans while the document is hidden, then resumes on visibilitychange', () => {
    setVisibilityState('hidden');
    const { editor, model, monaco, setModelMarkers } = createHarness();

    renderHook(() => useInlineLint(editor, monaco, activeTab));

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(setModelMarkers).not.toHaveBeenCalled();

    act(() => {
      setVisibilityState('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(setModelMarkers).toHaveBeenCalledWith(
      model,
      LINGUA_LINT_MARKER_OWNER,
      expect.arrayContaining([
        expect.objectContaining({
          source: LINGUA_LINT_MARKER_OWNER,
          message: 'editor.lint.strictEquality.message',
        }),
      ])
    );
  });

  it('still clears custom markers immediately when lint is disabled while hidden', () => {
    setVisibilityState('hidden');
    useSettingsStore.setState({
      inlineLintEnabledByLanguage: { javascript: false, typescript: true },
    });
    const { editor, model, monaco, setModelMarkers } = createHarness();

    renderHook(() => useInlineLint(editor, monaco, activeTab));

    expect(setModelMarkers).toHaveBeenCalledWith(
      model,
      LINGUA_LINT_MARKER_OWNER,
      []
    );
  });
});
