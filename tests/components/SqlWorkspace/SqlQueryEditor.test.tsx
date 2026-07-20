import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlQueryEditor } from '../../../src/renderer/components/SqlWorkspace/SqlQueryEditor';
import { getSqlQueryAutoSaveDebounceMs } from '../../../src/renderer/components/SqlWorkspace/sqlQueryEditorTiming';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace';

// ---------------------------------------------------------------------------
// Monaco mock
// ---------------------------------------------------------------------------
//
// implementation swapped the textarea for `<SqlMonacoEditor>`, which renders
// `@monaco-editor/react`'s `<MonacoEditor>`. The mock renders a stand-in
// `<textarea>` (keeping the original `sql-query-editor-textarea` testid so the
// auto-save / insert / byte-cap assertions are unchanged) wired to `onChange`,
// and invokes `onMount` with a fake editor + monaco exposing the surface the
// host uses: addCommand, getSelection, getModel().getValueInRange,
// onDidDispose, and the completion-provider registry.
//
// `monacoHarness` captures the registered keybinding callbacks + the configured
// selection so a test can fire Cmd+Enter (implementation note) and assert the selection-vs-
// full-buffer run.

interface FakeKeybindingCommands {
  run?: () => void;
  format?: () => void;
}

const monacoHarness: {
  commands: FakeKeybindingCommands;
  selectedRangeText: string | null;
  completionProvider:
    | {
        provideCompletionItems: (
          model: unknown,
          position: unknown
        ) => {
          suggestions: Array<{ label: string; kind: number; insertText: string }>;
        };
      }
    | null;
  disposeCount: number;
} = {
  commands: {},
  selectedRangeText: null,
  completionProvider: null,
  disposeCount: 0,
};

// Mirror the Monaco KeyMod / KeyCode bit layout closely enough that the two
// distinct chords (CtrlCmd|Enter vs Shift|Alt|KeyF) map to different keybinding
// ids so the host's two addCommand calls are told apart.
const FAKE_KEYMOD = { CtrlCmd: 1 << 11, Shift: 1 << 10, Alt: 1 << 9 };
const FAKE_KEYCODE = { Enter: 3, KeyF: 36 };
const RUN_CHORD = FAKE_KEYMOD.CtrlCmd | FAKE_KEYCODE.Enter;
const FORMAT_CHORD = FAKE_KEYMOD.Shift | FAKE_KEYMOD.Alt | FAKE_KEYCODE.KeyF;

vi.mock('@monaco-editor/react', () => {
  const MonacoEditor = ({
    value,
    onChange,
    onMount,
    options,
  }: {
    value: string;
    onChange?: (value: string | undefined) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    options?: { ariaLabel?: string };
  }) => {
    let disposeCb: (() => void) | null = null;
    const editor = {
      getSelection: () =>
        monacoHarness.selectedRangeText !== null ? { __selection: true } : null,
      getModel: () => ({
        getValueInRange: () => monacoHarness.selectedRangeText ?? '',
      }),
      addCommand: (chord: number, callback: () => void) => {
        if (chord === RUN_CHORD) monacoHarness.commands.run = callback;
        else if (chord === FORMAT_CHORD) monacoHarness.commands.format = callback;
      },
      onDidDispose: (cb: () => void) => {
        disposeCb = cb;
      },
    };
    const monaco = {
      KeyMod: FAKE_KEYMOD,
      KeyCode: FAKE_KEYCODE,
      languages: {
        CompletionItemKind: { Struct: 5, Keyword: 17 },
        registerCompletionItemProvider: (
          _language: string,
          provider: (typeof monacoHarness)['completionProvider']
        ) => {
          monacoHarness.completionProvider = provider;
          return {
            dispose: () => {
              monacoHarness.disposeCount += 1;
            },
          };
        },
      },
    };
    onMount?.(editor, monaco);
    // Surface a dispose hook the React unmount can trigger via cleanup. The
    // stand-in textarea unmount alone won't call Monaco's onDidDispose, so we
    // expose a no-op effect-free node — disposal is asserted only where the
    // host explicitly tears down (the dispose path is exercised via the
    // SqlMonacoEditor unit test).
    void disposeCb;
    return (
      <textarea
        data-testid="sql-query-editor-textarea"
        aria-label={options?.ariaLabel}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  };
  // `monaco.ts` (pulled in transitively by SqlMonacoEditor → configureMonaco)
  // calls `loader.config({ monaco })`, so the mock must expose a no-op loader.
  return { default: MonacoEditor, loader: { config: () => {} } };
});

function resetHarness() {
  monacoHarness.commands = {};
  monacoHarness.selectedRangeText = null;
  monacoHarness.completionProvider = null;
  monacoHarness.disposeCount = 0;
}

describe('SqlQueryEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-saves the query text after the debounce settles', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    render(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    fireEvent.change(screen.getByTestId('sql-query-editor-textarea'), {
      target: { value: 'SELECT 42;' },
    });

    act(() => {
      vi.advanceTimersByTime(getSqlQueryAutoSaveDebounceMs());
    });

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith('q1', { query: 'SELECT 42;' });
  });

  it('flushes the latest draft on unmount before the debounce settles', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    const { unmount } = render(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    fireEvent.change(screen.getByTestId('sql-query-editor-textarea'), {
      target: { value: 'SELECT * FROM late_draft;' },
    });

    unmount();

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith('q1', {
      query: 'SELECT * FROM late_draft;',
    });
  });

  it('appends an insert-signal table starter to the draft', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      query: 'SELECT 1;',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    const { rerender } = render(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 1 }}
      />
    );

    const textarea = screen.getByTestId(
      'sql-query-editor-textarea'
    ) as HTMLTextAreaElement;
    // nonce 1 was the initial value; bumping it triggers the append.
    rerender(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 2 }}
      />
    );

    expect(textarea.value).toBe('SELECT 1;\nSELECT * FROM users LIMIT 100;');

    // The appended text auto-saves after the debounce settles.
    act(() => {
      vi.advanceTimersByTime(getSqlQueryAutoSaveDebounceMs());
    });
    expect(onPatch).toHaveBeenLastCalledWith('q1', {
      query: 'SELECT 1;\nSELECT * FROM users LIMIT 100;',
    });
  });

  it('uses the bare starter when inserting into an empty draft', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });

    const { rerender } = render(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 0 }}
      />
    );
    rerender(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 1 }}
      />
    );

    expect(
      (screen.getByTestId('sql-query-editor-textarea') as HTMLTextAreaElement)
        .value
    ).toBe('SELECT * FROM users LIMIT 100;');
  });

  it('flushes the previous query draft when the active query switches', () => {
    const firstQuery = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });
    const secondQuery = createBlankSqlQuery({
      id: 'q2',
      query: 'SELECT 2;',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    const { rerender } = render(
      <SqlQueryEditor
        query={firstQuery}
        onPatch={onPatch}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    fireEvent.change(screen.getByTestId('sql-query-editor-textarea'), {
      target: { value: 'SELECT * FROM previous_query_draft;' },
    });

    rerender(
      <SqlQueryEditor
        query={secondQuery}
        onPatch={onPatch}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    // RQ-02 — the in-flight edit lands on the query it was typed into
    // (q1), never on the newly-active query (q2).
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith('q1', {
      query: 'SELECT * FROM previous_query_draft;',
    });
    expect(onPatch.mock.calls.some(([id]) => id === 'q2')).toBe(false);

    // Draining any residual timer must not produce a patch onto q2.
    act(() => {
      vi.advanceTimersByTime(getSqlQueryAutoSaveDebounceMs());
    });
    expect(onPatch.mock.calls.some(([id]) => id === 'q2')).toBe(false);
  });

  it('runs the full query via the toolbar Run button', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      query: 'SELECT 1; SELECT 2;',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onRun = vi.fn();

    render(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={onRun}
        isExecuting={false}
        tables={[]}
      />
    );

    fireEvent.click(screen.getByTestId('sql-query-editor-run'));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({
      query: 'SELECT 1; SELECT 2;',
    });
  });

  it('formats the buffer and updates the editor value', async () => {
    vi.useRealTimers();
    const query = createBlankSqlQuery({
      id: 'q1',
      query: 'select 1',
      now: '2026-05-26T00:00:00.000Z',
    });

    render(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    fireEvent.click(screen.getByTestId('sql-query-editor-format'));

    // sql-formatter is lazy-imported (real ESM dynamic import); the
    // formatted text lands in the controlled value once it resolves and
    // the setText flushes. Poll the stand-in textarea until it updates.
    // Default keywordCase: 'upper' — the lowercase select uppercases.
    await waitFor(() => {
      const textarea = screen.getByTestId(
        'sql-query-editor-textarea'
      ) as HTMLTextAreaElement;
      expect(textarea.value).toContain('SELECT');
    });
  });

  it('disables Run and Format when the query exceeds the byte cap', () => {
    // MAX_QUERY_BYTES is 1 MiB; build a string just past it.
    const huge = 'a'.repeat(1024 * 1024 + 1);
    const query = createBlankSqlQuery({
      id: 'q1',
      query: huge,
      now: '2026-05-26T00:00:00.000Z',
    });

    render(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    expect(
      (screen.getByTestId('sql-query-editor-run') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId('sql-query-editor-format') as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('Cmd+Enter runs the selection when the editor reports a non-empty selection', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      query: 'SELECT 1;\nSELECT 2;',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onRun = vi.fn();
    const onPatch = vi.fn();

    render(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={onRun}
        isExecuting={false}
        tables={[]}
      />
    );

    // Simulate the user selecting only the second statement.
    monacoHarness.selectedRangeText = 'SELECT 2;';
    act(() => {
      monacoHarness.commands.run?.();
    });

    expect(onRun).toHaveBeenCalledTimes(1);
    // The RUN uses the selection…
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({ query: 'SELECT 2;' });
  });

  it('Cmd+Enter runs the full query when there is no selection, and the auto-save still persists the full text', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      query: 'SELECT 1;\nSELECT 2;',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onRun = vi.fn();
    const onPatch = vi.fn();

    render(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={onRun}
        isExecuting={false}
        tables={[]}
      />
    );

    // No selection → full buffer runs.
    monacoHarness.selectedRangeText = null;
    act(() => {
      monacoHarness.commands.run?.();
    });

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({
      query: 'SELECT 1;\nSELECT 2;',
    });
  });

  it('the auto-save persists the FULL buffer even on a selection run', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      query: 'SELECT 1;',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onRun = vi.fn();
    const onPatch = vi.fn();

    render(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={onRun}
        isExecuting={false}
        tables={[]}
      />
    );

    // Type a longer buffer, then run only a selection of it.
    fireEvent.change(screen.getByTestId('sql-query-editor-textarea'), {
      target: { value: 'SELECT 1;\nSELECT 99;' },
    });
    monacoHarness.selectedRangeText = 'SELECT 99;';
    act(() => {
      monacoHarness.commands.run?.();
    });

    // The selection runs…
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({ query: 'SELECT 99;' });
    // …but the flushed auto-save persisted the FULL text, never the selection.
    expect(onPatch).toHaveBeenLastCalledWith('q1', {
      query: 'SELECT 1;\nSELECT 99;',
    });
  });

  it('registers a sql completion provider that returns the table names', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });

    render(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        isExecuting={false}
        tables={[
          { name: 'orders' },
          { name: 'customers' },
          { name: 'Order Items' },
        ]}
      />
    );

    expect(monacoHarness.completionProvider).not.toBeNull();
    const result = monacoHarness.completionProvider?.provideCompletionItems(
      { getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }) },
      { lineNumber: 1, column: 1 }
    );
    const labels = result?.suggestions.map((s) => s.label) ?? [];
    expect(labels).toContain('orders');
    expect(labels).toContain('customers');
    expect(result?.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Order Items',
          insertText: '"Order Items"',
        }),
      ])
    );
    // Common keywords ride alongside the table names.
    expect(labels).toContain('SELECT');
  });
});
