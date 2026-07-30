import { act, renderHook } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../src/renderer/i18n/locales/en/common.json';
import es from '../../src/renderer/i18n/locales/es/common.json';
import { useLanguageIntelligenceDiagnostics } from '../../src/renderer/hooks/useLanguageIntelligenceDiagnostics';
import { loadLanguageIntelligenceAdapter } from '../../src/renderer/languageIntelligence';

async function runDeferredDiagnostics(language: string): Promise<void> {
  await vi.advanceTimersByTimeAsync(150);
  await loadLanguageIntelligenceAdapter(language);
}

describe('useLanguageIntelligenceDiagnostics', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { common: en }, es: { common: es } },
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  });

  it('writes Python diagnostics to a dedicated Monaco marker owner', async () => {
    const model = { id: 'model-1' };
    const setModelMarkers = vi.fn();
    const editor = {
      getModel: () => model,
    };
    const monaco = {
      MarkerSeverity: {
        Error: 8,
        Warning: 4,
        Info: 2,
      },
      editor: {
        setModelMarkers,
      },
    };

    renderHook(() =>
      useLanguageIntelligenceDiagnostics(editor as never, monaco as never, {
        id: 'tab-1',
        language: 'python',
        content: 'def broken()\n    pass',
      })
    );

    await act(async () => {
      await runDeferredDiagnostics('python');
    });

    expect(setModelMarkers).toHaveBeenCalledWith(model, 'lingua-language-intelligence', [
      expect.objectContaining({
        startLineNumber: 1,
        message: 'Python block statements need a trailing colon.',
        severity: 8,
        source: 'language-intelligence',
      }),
    ]);
  });

  it('re-runs diagnostics in the new locale when the UI language changes mid-session', async () => {
    const model = { id: 'model-1' };
    const setModelMarkers = vi.fn();
    const editor = { getModel: () => model };
    const monaco = {
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
      editor: { setModelMarkers },
    };

    renderHook(() =>
      useLanguageIntelligenceDiagnostics(editor as never, monaco as never, {
        id: 'tab-1',
        language: 'python',
        content: 'def broken()\n    pass',
      })
    );

    await act(async () => {
      await runDeferredDiagnostics('python');
    });

    expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'lingua-language-intelligence', [
      expect.objectContaining({
        message: 'Python block statements need a trailing colon.',
      }),
    ]);

    await act(async () => {
      await i18next.changeLanguage('es');
    });
    await act(async () => {
      await runDeferredDiagnostics('python');
    });

    expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'lingua-language-intelligence', [
      expect.objectContaining({
        message: 'Las sentencias de bloque de Python necesitan dos puntos al final.',
      }),
    ]);
  });

  it('clears markers when the active language has no adapter', () => {
    const model = { id: 'model-1' };
    const setModelMarkers = vi.fn();
    const editor = {
      getModel: () => model,
    };
    const monaco = {
      MarkerSeverity: {
        Error: 8,
        Warning: 4,
        Info: 2,
      },
      editor: {
        setModelMarkers,
      },
    };

    renderHook(() =>
      useLanguageIntelligenceDiagnostics(editor as never, monaco as never, {
        id: 'tab-1',
        language: 'javascript',
        content: 'console.log("ok")',
      })
    );

    expect(setModelMarkers).toHaveBeenCalledWith(model, 'lingua-language-intelligence', []);
  });

  it('does not run a deferred analyzer after the active language changes', async () => {
    const model = { id: 'model-1' };
    const setModelMarkers = vi.fn();
    const editor = { getModel: () => model };
    const monaco = {
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
      editor: { setModelMarkers },
    };
    const { rerender } = renderHook(
      ({ language }) =>
        useLanguageIntelligenceDiagnostics(editor as never, monaco as never, {
          id: 'tab-1',
          language,
          content: 'def broken()\n    pass',
        }),
      { initialProps: { language: 'python' } }
    );

    rerender({ language: 'javascript' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(setModelMarkers).toHaveBeenCalledWith(
      model,
      'lingua-language-intelligence',
      []
    );
    expect(
      setModelMarkers.mock.calls.some((call) => Array.isArray(call[2]) && call[2].length > 0)
    ).toBe(false);
  });
});
