/**
 * Shared `@monaco-editor/react` mock for the notebook cell tests.
 *
 * jsdom cannot run the real Monaco editor, so the notebook tests mock the
 * library. The mocked `<MonacoEditor>` renders a `<textarea>` carrying the
 * `notebook-code-cell-source` testid (the editor surface the cell exposes
 * while editing) and synchronously invokes `onMount` with a fake editor +
 * monaco namespace wide enough for `NotebookCellMonaco`'s wiring AND the
 * `useInlineLint` hook it runs. `useMonaco()` returns `null` so the static
 * (inactive) cell view falls back to its plain-text content.
 *
 * `cellMockHarness` is a module singleton: both the test's static import and
 * the `vi.mock` factory's dynamic import resolve the same instance, so a
 * test can drive the captured run / blur / dispose callbacks. Each test file
 * registers the mock with:
 *
 *   vi.mock('@monaco-editor/react', async () => {
 *     const m = await import('../../__fixtures__/monacoEditorMock');
 *     return m.makeMonacoEditorMock();
 *   });
 */

import { createElement, useEffect, useRef } from 'react';

/** Fake Monaco key constants — distinct bit values so chords don't collide. */
export const FAKE_KEYMOD = { CtrlCmd: 1 << 11, Shift: 1 << 10, Alt: 1 << 9 };
export const FAKE_KEYCODE = { Enter: 3, Escape: 9 };

/** Chords the cell editor registers, precomputed for test assertions. */
export const RUN_IN_PLACE_CHORD = FAKE_KEYMOD.CtrlCmd | FAKE_KEYCODE.Enter;
export const RUN_ADVANCE_CHORD = FAKE_KEYMOD.Shift | FAKE_KEYCODE.Enter;
export const RUN_INSERT_CHORD = FAKE_KEYMOD.Alt | FAKE_KEYCODE.Enter;
export const ESCAPE_CHORD = FAKE_KEYCODE.Escape;

export interface MonacoCellHarness {
  /** Captured `editor.addCommand` callbacks keyed by chord. */
  commands: Map<number, () => void>;
  /** Captured `onDidBlurEditorWidget` callback. */
  blur?: () => void;
  /** Captured `onDidDispose` callback. */
  dispose?: () => void;
  /** Language of the most recent mount. */
  lastMountLanguage?: string;
  /** How many times a Monaco editor mounted (proxy for live instances). */
  mountCount: number;
}

export const cellMockHarness: MonacoCellHarness = {
  commands: new Map(),
  mountCount: 0,
};

export function resetMonacoCellHarness(): void {
  cellMockHarness.commands = new Map();
  cellMockHarness.blur = undefined;
  cellMockHarness.dispose = undefined;
  cellMockHarness.lastMountLanguage = undefined;
  cellMockHarness.mountCount = 0;
}

interface MockEditorProps {
  value?: string;
  language?: string;
  onChange?: (value: string | undefined) => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
  options?: { ariaLabel?: string; readOnly?: boolean };
}

export function makeMonacoEditorMock() {
  const MonacoEditor = ({
    value,
    language,
    onChange,
    onMount,
    options,
  }: MockEditorProps) => {
    // CRITICAL: the real `@monaco-editor/react` fires `onMount` exactly once,
    // not on every render. `NotebookCellMonaco.onMount` calls setState
    // (setEditorInstance / setMonacoInstance), so calling it per-render would
    // be an infinite render loop. A one-shot effect mirrors the library.
    const mountedRef = useRef(false);
    useEffect(() => {
      if (mountedRef.current) return;
      mountedRef.current = true;
      const editor = {
        focus: () => {},
        getModel: () => ({
          uri: { toString: () => 'inmemory://notebook-cell' },
        }),
        getContentHeight: () => 80,
        addCommand: (chord: number, callback: () => void) => {
          cellMockHarness.commands.set(chord, callback);
        },
        onDidContentSizeChange: () => {},
        onDidBlurEditorWidget: (cb: () => void) => {
          cellMockHarness.blur = cb;
        },
        onDidDispose: (cb: () => void) => {
          cellMockHarness.dispose = cb;
        },
      };
      const monaco = {
        KeyMod: FAKE_KEYMOD,
        KeyCode: FAKE_KEYCODE,
        MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
        editor: {
          defineTheme: () => {},
          setModelMarkers: () => {},
          getModelMarkers: () => [],
          colorizeElement: async () => {},
        },
        languages: {
          registerCodeActionProvider: () => ({ dispose: () => {} }),
          // `typescript` intentionally absent so setMonacoInlineLintEnabled
          // no-ops in tests (it guards on `m.languages.typescript`).
        },
      };
      cellMockHarness.mountCount += 1;
      cellMockHarness.lastMountLanguage = language;
      onMount?.(editor, monaco);
    }, []);
    return createElement('textarea', {
      'data-testid': 'notebook-code-cell-source',
      'aria-label': options?.ariaLabel,
      readOnly: options?.readOnly,
      value,
      onChange: (event: { target: { value: string } }) =>
        onChange?.(event.target.value),
    });
  };

  return {
    default: MonacoEditor,
    useMonaco: () => null,
    loader: { config: () => {} },
  };
}
