import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SqlMonacoEditor,
  type SqlMonacoEditorProps,
} from '../../../src/renderer/components/SqlWorkspace/SqlMonacoEditor';
import { splitSqlStatements } from '../../../src/shared/sqlStatements';

// ---------------------------------------------------------------------------
// Monaco mock: the host's wiring only — onChange, the keybinding commands,
// cursor reports, the gutter Run glyphs, and provider disposal on unmount.
// ---------------------------------------------------------------------------

interface CompletionItem {
  label: string;
  kind: number;
  insertText: string;
  detail?: string;
}

interface Harness {
  commands: Map<number, () => void>;
  selectedRangeText: string | null;
  cursorOffset: number;
  glyphs: Array<{ range: { startLineNumber: number }; options: { glyphMarginClassName: string } }>;
  onCursor: ((event: unknown) => void) | null;
  onMouseDown: ((event: unknown) => void) | null;
  disposeCount: number;
  didDispose: (() => void) | null;
  completionProvider:
    | { provideCompletionItems: (m: unknown, p: unknown) => { suggestions: CompletionItem[] } }
    | null;
}

const harness: Harness = {
  commands: new Map(),
  selectedRangeText: null,
  cursorOffset: 0,
  glyphs: [],
  onCursor: null,
  onMouseDown: null,
  disposeCount: 0,
  didDispose: null,
  completionProvider: null,
};

const KeyMod = { CtrlCmd: 1 << 11, Shift: 1 << 10, Alt: 1 << 9 };
const KeyCode = { Enter: 3, KeyF: 36, KeyS: 49, Period: 87 };
const GLYPH_MARGIN = 2;
const chord = {
  statement: KeyMod.CtrlCmd | KeyCode.Enter,
  selection: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Enter,
  all: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
  cancel: KeyMod.CtrlCmd | KeyCode.Period,
  save: KeyMod.CtrlCmd | KeyCode.KeyS,
  saveAs: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyS,
  format: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyF,
};

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
    options?: { ariaLabel?: string; glyphMargin?: boolean };
  }) => {
    const disposable = { dispose: () => {} };
    const editor = {
      getSelection: () => (harness.selectedRangeText !== null ? { __selection: true } : null),
      getPosition: () => ({ lineNumber: 1, column: 1 }),
      getModel: () => ({
        getValueInRange: () => harness.selectedRangeText ?? '',
        getValue: () => value,
        getOffsetAt: (position: { offset?: number }) => position.offset ?? harness.cursorOffset,
      }),
      addCommand: (key: number, callback: () => void) => {
        harness.commands.set(key, callback);
      },
      createDecorationsCollection: () => ({
        set: (glyphs: Harness['glyphs']) => {
          harness.glyphs = glyphs;
        },
      }),
      onDidChangeCursorSelection: (listener: (event: unknown) => void) => {
        harness.onCursor = listener;
        return disposable;
      },
      onMouseDown: (listener: (event: unknown) => void) => {
        harness.onMouseDown = listener;
        return disposable;
      },
      onDidDispose: (cb: () => void) => {
        harness.didDispose = cb;
      },
    };
    const monaco = {
      KeyMod,
      KeyCode,
      Range: class {
        constructor(public startLineNumber: number) {}
      },
      editor: { defineTheme: vi.fn(), MouseTargetType: { GUTTER_GLYPH_MARGIN: GLYPH_MARGIN } },
      languages: {
        CompletionItemKind: { Struct: 5, Field: 4, Keyword: 17 },
        registerCompletionItemProvider: (_lang: string, provider: Harness['completionProvider']) => {
          harness.completionProvider = provider;
          return {
            dispose: () => {
              harness.disposeCount += 1;
            },
          };
        },
      },
    };
    onMount?.(editor, monaco);
    return (
      <textarea
        data-testid="sql-monaco-textarea"
        data-glyph-margin={String(options?.glyphMargin)}
        aria-label={options?.ariaLabel}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  };
  // `monaco.ts` (pulled in via configureMonaco) calls `loader.config(...)`.
  return { default: MonacoEditor, loader: { config: () => {} } };
});

function resetHarness() {
  harness.commands = new Map();
  harness.selectedRangeText = null;
  harness.cursorOffset = 0;
  harness.glyphs = [];
  harness.onCursor = null;
  harness.onMouseDown = null;
  harness.disposeCount = 0;
  harness.didDispose = null;
  harness.completionProvider = null;
}

/** Invoke the captured completion provider with a stub model/position. */
function runCompletions() {
  const model = {
    getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
  };
  const position = { lineNumber: 1, column: 1 };
  return harness.completionProvider?.provideCompletionItems(model, position).suggestions ?? [];
}

function renderHost(props: Partial<SqlMonacoEditorProps> = {}) {
  const value = props.value ?? 'SELECT 1;';
  const handlers = {
    onChange: vi.fn(),
    onRunCommand: vi.fn(),
    onCancelShortcut: vi.fn(),
    onSaveShortcut: vi.fn(),
    onCursorChange: vi.fn(),
    onFormatShortcut: vi.fn(),
  };
  const view = render(
    <SqlMonacoEditor
      value={value}
      statements={splitSqlStatements(value)}
      runGlyphLabel="Run statement"
      tables={[]}
      ariaLabel="SQL query editor"
      {...handlers}
      {...props}
    />
  );
  return { ...view, ...handlers };
}

describe('SqlMonacoEditor', () => {
  beforeEach(resetHarness);
  afterEach(() => vi.clearAllMocks());

  it('passes edits through onChange', () => {
    const { onChange } = renderHost();
    fireEvent.change(screen.getByTestId('sql-monaco-textarea'), {
      target: { value: 'SELECT 2;' },
    });
    expect(onChange).toHaveBeenCalledWith('SELECT 2;');
  });

  it('maps each run chord to its mode with the cursor and selection', () => {
    const { onRunCommand } = renderHost({ value: 'SELECT 1;\nSELECT 2;' });
    harness.cursorOffset = 12;
    act(() => harness.commands.get(chord.statement)?.());
    expect(onRunCommand).toHaveBeenLastCalledWith('statement', {
      offset: 12,
      selectedText: null,
      value: 'SELECT 1;\nSELECT 2;',
    });
    harness.selectedRangeText = 'SELECT 2;';
    act(() => harness.commands.get(chord.selection)?.());
    expect(onRunCommand).toHaveBeenLastCalledWith('selection', expect.objectContaining({ selectedText: 'SELECT 2;' }));
    act(() => harness.commands.get(chord.all)?.());
    expect(onRunCommand).toHaveBeenLastCalledWith('all', expect.objectContaining({ offset: 12 }));
  });

  it('wires Cancel, Save, Save as and Format', () => {
    const { onCancelShortcut, onSaveShortcut, onFormatShortcut } = renderHost();
    act(() => harness.commands.get(chord.cancel)?.());
    act(() => harness.commands.get(chord.save)?.());
    act(() => harness.commands.get(chord.saveAs)?.());
    act(() => harness.commands.get(chord.format)?.());
    expect(onCancelShortcut).toHaveBeenCalledOnce();
    expect(onSaveShortcut.mock.calls).toEqual([[false], [true]]);
    expect(onFormatShortcut).toHaveBeenCalledOnce();
  });

  it('reports the cursor and the selection range', () => {
    const { onCursorChange } = renderHost();
    act(() =>
      harness.onCursor?.({
        selection: {
          getPosition: () => ({ offset: 7 }),
          getStartPosition: () => ({ offset: 3 }),
          getEndPosition: () => ({ offset: 7 }),
        },
      })
    );
    expect(onCursorChange).toHaveBeenCalledWith({ offset: 7, selectionStart: 3, selectionEnd: 7 });
  });

  it('puts a Run glyph on each statement and runs the one clicked in the gutter', () => {
    const value = 'SELECT 1;\n\nSELECT 2;';
    const { onRunCommand } = renderHost({ value });
    expect(screen.getByTestId('sql-monaco-textarea').dataset.glyphMargin).toBe('true');
    expect(harness.glyphs.map((glyph) => glyph.range.startLineNumber)).toEqual([1, 3]);
    expect(harness.glyphs[0]?.options.glyphMarginClassName).toBe('lingua-sql-run-glyph');
    act(() => harness.onMouseDown?.({ target: { type: GLYPH_MARGIN, position: { lineNumber: 3 } } }));
    expect(onRunCommand).toHaveBeenCalledWith('statement', { offset: value.indexOf('SELECT 2'), selectedText: null });
    act(() => harness.onMouseDown?.({ target: { type: 1, position: { lineNumber: 3 } } }));
    expect(onRunCommand).toHaveBeenCalledOnce();
  });

  it('offers table, column, and keyword completions', () => {
    renderHost({ value: '', tables: [
          {
            name: 'users',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'user name', type: 'VARCHAR' },
            ],
          },
          { name: 'orders', columns: [{ name: 'id', type: 'BIGINT' }] },
        ] });
    const suggestions = runCompletions();
    const byLabel = (label: string) =>
      suggestions.find((s) => s.label === label);

    // Table name → quoted identifier, Struct kind.
    expect(byLabel('users')).toMatchObject({ kind: 5, insertText: '"users"' });

    // Simple column → bare insert, Field kind; the detail carries the type.
    const idCol = byLabel('id');
    expect(idCol).toMatchObject({ kind: 4, insertText: 'id' });
    // `id` lives in both tables → deduped to one entry naming both owners.
    expect(idCol?.detail).toContain('users');
    expect(idCol?.detail).toContain('orders');

    // Column with a space → quoted identifier.
    expect(byLabel('user name')?.insertText).toBe('"user name"');

    // Keywords still present.
    expect(byLabel('SELECT')).toMatchObject({ kind: 17 });
  });

  it('quotes schema and table independently in non-main table completions', () => {
    renderHost({ value: '', tables: [
          {
            name: 'lingua_ledger.runs',
            sqlName: 'runs',
            schemaName: 'lingua_ledger',
          },
        ] });

    expect(runCompletions().find((suggestion) => suggestion.label === 'lingua_ledger.runs')).toMatchObject({
      insertText: '"lingua_ledger"."runs"',
    });
  });

  it('disposes the completion provider when the editor disposes', () => {
    const { unmount } = renderHost();
    expect(harness.disposeCount).toBe(0);
    // Monaco fires onDidDispose when the editor tears down; React unmount of
    // <MonacoEditor> is what triggers it in the real library. Invoke the
    // captured callback to assert the host's cleanup runs.
    unmount();
    act(() => harness.didDispose?.());
    expect(harness.disposeCount).toBe(1);
  });
});
