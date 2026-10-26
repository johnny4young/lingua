import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
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
  scrollLeftResets: number;
  externalEdits: number;
  documentResets: number;
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
  scrollLeftResets: 0,
  externalEdits: 0,
  documentResets: 0,
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
    defaultValue,
    onChange,
    onMount,
    options,
  }: {
    defaultValue?: string;
    onChange?: (value: string | undefined) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    options?: { ariaLabel?: string; glyphMargin?: boolean };
  }) => {
    // An uncontrolled model, like Monaco's: only typing and executeEdits change it.
    const [value, setValue] = useState(defaultValue ?? '');
    const valueRef = useRef(value);
    valueRef.current = value;
    const disposable = { dispose: () => {} };
    const editor = {
      executeEdits: (_source: string, edits: Array<{ text: string }>) => {
        harness.externalEdits += 1;
        valueRef.current = edits[0]?.text ?? '';
        setValue(valueRef.current);
        return true;
      },
      pushUndoStop: () => true,
      getSelection: () => (harness.selectedRangeText !== null ? { __selection: true } : null),
      getPosition: () => ({ lineNumber: 1, column: 1 }),
      getModel: () => ({
        getValueInRange: () => harness.selectedRangeText ?? '',
        getValue: () => valueRef.current,
        getFullModelRange: () => ({}),
        setValue: (next: string) => {
          harness.documentResets += 1;
          harness.glyphs = []; // Monaco clears decorations when setValue resets a document.
          valueRef.current = next;
          setValue(next);
        },
        getOffsetAt: (position: { offset?: number }) => position.offset ?? harness.cursorOffset,
      }),
      addCommand: (key: number, callback: () => void) => {
        harness.commands.set(key, callback);
      },
      setScrollLeft: () => {
        harness.scrollLeftResets += 1;
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
        CompletionItemKind: { Function: 1, Struct: 5, Field: 4, Keyword: 17 },
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
        onChange={(event) => {
          valueRef.current = event.target.value;
          setValue(event.target.value);
          onChange?.(event.target.value);
        }}
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
  harness.scrollLeftResets = 0;
  harness.externalEdits = 0;
  harness.documentResets = 0;
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

  it('scrolls back to the left edge only when the text is replaced from outside', () => {
    const { rerender, onChange } = renderHost({ value: 'SELECT 1;' });
    fireEvent.change(screen.getByTestId('sql-monaco-textarea'), { target: { value: 'SELECT 12;' } });
    expect(onChange).toHaveBeenCalledWith('SELECT 12;');
    rerender(
      <SqlMonacoEditor
        value="SELECT 12;"
        statements={splitSqlStatements('SELECT 12;')}
        runGlyphLabel="Run statement"
        tables={[]}
        ariaLabel="SQL query editor"
        onChange={onChange}
        onRunCommand={vi.fn()}
        onCancelShortcut={vi.fn()}
        onSaveShortcut={vi.fn()}
        onCursorChange={vi.fn()}
        onFormatShortcut={vi.fn()}
      />
    );
    expect(harness.scrollLeftResets).toBe(0);
    rerender(
      <SqlMonacoEditor
        value={'SELECT\n  12;'}
        statements={splitSqlStatements('SELECT\n  12;')}
        runGlyphLabel="Run statement"
        tables={[]}
        ariaLabel="SQL query editor"
        onChange={onChange}
        onRunCommand={vi.fn()}
        onCancelShortcut={vi.fn()}
        onSaveShortcut={vi.fn()}
        onCursorChange={vi.fn()}
        onFormatShortcut={vi.fn()}
      />
    );
    expect(harness.scrollLeftResets).toBe(1);
  });

  it('ignores a render that lags its own typing and applies an external replacement', () => {
    const { rerender, onChange } = renderHost({ value: 'SELECT 1;' });
    const textarea = screen.getByTestId('sql-monaco-textarea') as HTMLTextAreaElement;
    const host = (value: string, documentKey?: string, statements = splitSqlStatements(value)) => (
      <SqlMonacoEditor
        value={value}
        {...(documentKey ? { documentKey } : {})}
        statements={statements}
        runGlyphLabel="Run statement"
        tables={[]}
        ariaLabel="SQL query editor"
        onChange={onChange}
        onRunCommand={vi.fn()}
        onCancelShortcut={vi.fn()}
        onSaveShortcut={vi.fn()}
        onCursorChange={vi.fn()}
        onFormatShortcut={vi.fn()}
      />
    );
    fireEvent.change(textarea, { target: { value: 'SELECT 12;' } });
    fireEvent.change(textarea, { target: { value: 'SELECT 123;' } });
    rerender(host('SELECT 12;'));
    expect(textarea.value).toBe('SELECT 123;');
    rerender(host('SELECT 123;'));
    expect(harness.externalEdits).toBe(0);
    rerender(host('SELECT 9;'));
    expect(textarea.value).toBe('SELECT 9;');
    expect(harness.externalEdits).toBe(1);
    expect(onChange).not.toHaveBeenCalledWith('SELECT 9;');

    // A new document whose text matches an earlier keystroke still replaces the model, without undo.
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.change(textarea, { target: { value: 'x' } });
    rerender(host('', 'q2'));
    expect(textarea.value).toBe('');
    expect(harness.documentResets).toBe(1);
    expect(harness.externalEdits).toBe(1);

    // A different document must reset history even when its text is exactly the current model.
    fireEvent.change(textarea, { target: { value: 'SELECT 8;' } });
    const sameStatements = splitSqlStatements('SELECT 8;');
    rerender(host('SELECT 8;', 'q2', sameStatements));
    const emitted = onChange.mock.calls.length;
    rerender(host('SELECT 8;', 'q3', sameStatements));
    expect(textarea.value).toBe('SELECT 8;');
    expect(harness.documentResets).toBe(2);
    expect(harness.externalEdits).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(emitted);
    expect(harness.glyphs.map(glyph => glyph.range.startLineNumber)).toEqual([1]);
    // Re-rendering that same document must keep its existing undo history.
    rerender(host('SELECT 8;', 'q3', sameStatements));
    expect(harness.documentResets).toBe(2);
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

  it('quotes and adds keywords in the engine of the connection, with its functions', () => {
    renderHost({
      value: '',
      engine: 'mysql',
      functions: ['order_count'],
      tables: [{ name: 'orders', sqlName: 'orders', schemaName: 'billing', columns: [{ name: 'created at', type: 'datetime' }] }],
    });
    const suggestions = runCompletions();
    const byLabel = (label: string) => suggestions.find((suggestion) => suggestion.label === label);
    expect(byLabel('orders')?.insertText).toBe('`billing`.`orders`');
    expect(byLabel('created at')?.insertText).toBe('`created at`');
    expect(byLabel('order_count')).toMatchObject({ kind: 1, insertText: 'order_count' });
    expect(byLabel('ON DUPLICATE KEY UPDATE')).toMatchObject({ kind: 17 });
    expect(byLabel('SUMMARIZE')).toBeUndefined();
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
