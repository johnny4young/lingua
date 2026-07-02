import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlMonacoEditor } from '../../../src/renderer/components/SqlWorkspace/SqlMonacoEditor';

// ---------------------------------------------------------------------------
// Monaco mock — see SqlQueryEditor.test.tsx for the rationale. This unit test
// targets the host's wiring directly: onChange passthrough, the two keybinding
// commands, and completion-provider disposal on unmount.
// ---------------------------------------------------------------------------

interface CompletionItem {
  label: string;
  kind: number;
  insertText: string;
  detail?: string;
}

interface Harness {
  commands: { run?: () => void; format?: () => void };
  selectedRangeText: string | null;
  disposeCount: number;
  didDispose: (() => void) | null;
  completionProvider:
    | { provideCompletionItems: (m: unknown, p: unknown) => { suggestions: CompletionItem[] } }
    | null;
}

const harness: Harness = {
  commands: {},
  selectedRangeText: null,
  disposeCount: 0,
  didDispose: null,
  completionProvider: null,
};

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
    const editor = {
      getSelection: () =>
        harness.selectedRangeText !== null ? { __selection: true } : null,
      getModel: () => ({
        getValueInRange: () => harness.selectedRangeText ?? '',
      }),
      addCommand: (chord: number, callback: () => void) => {
        if (chord === RUN_CHORD) harness.commands.run = callback;
        else if (chord === FORMAT_CHORD) harness.commands.format = callback;
      },
      onDidDispose: (cb: () => void) => {
        harness.didDispose = cb;
      },
    };
    const monaco = {
      KeyMod: FAKE_KEYMOD,
      KeyCode: FAKE_KEYCODE,
      editor: { defineTheme: vi.fn() },
      languages: {
        CompletionItemKind: { Struct: 5, Field: 4, Keyword: 17 },
        registerCompletionItemProvider: (
          _lang: string,
          provider: Harness['completionProvider']
        ) => {
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
        aria-label={options?.ariaLabel}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  };
  // `monaco.ts` (pulled in via configureMonaco) calls `loader.config(...)`.
  return { default: MonacoEditor, loader: { config: () => {} } };
});

// The host also calls defineCustomThemes(monaco) in beforeMount; the mock above
// does not invoke beforeMount, so that path is exercised only at runtime. The
// editorThemes import is otherwise inert here.

function resetHarness() {
  harness.commands = {};
  harness.selectedRangeText = null;
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
  return harness.completionProvider?.provideCompletionItems(model, position)
    .suggestions ?? [];
}

describe('SqlMonacoEditor', () => {
  beforeEach(resetHarness);
  afterEach(() => vi.clearAllMocks());

  it('passes edits through onChange', () => {
    const onChange = vi.fn();
    render(
      <SqlMonacoEditor
        value="SELECT 1;"
        onChange={onChange}
        onRunShortcut={vi.fn()}
        onFormatShortcut={vi.fn()}
        tables={[]}
        ariaLabel="SQL query editor"
      />
    );
    fireEvent.change(screen.getByTestId('sql-monaco-textarea'), {
      target: { value: 'SELECT 2;' },
    });
    expect(onChange).toHaveBeenCalledWith('SELECT 2;');
  });

  it('wires the Cmd+Enter command to onRunShortcut with the selected text', () => {
    const onRunShortcut = vi.fn();
    render(
      <SqlMonacoEditor
        value="SELECT 1;"
        onChange={vi.fn()}
        onRunShortcut={onRunShortcut}
        onFormatShortcut={vi.fn()}
        tables={[]}
        ariaLabel="SQL query editor"
      />
    );
    harness.selectedRangeText = 'SELECT 1;';
    act(() => harness.commands.run?.());
    expect(onRunShortcut).toHaveBeenCalledWith({ selectedText: 'SELECT 1;' });

    harness.selectedRangeText = null;
    act(() => harness.commands.run?.());
    expect(onRunShortcut).toHaveBeenLastCalledWith({ selectedText: null });
  });

  it('wires the Shift+Alt+F command to onFormatShortcut', () => {
    const onFormatShortcut = vi.fn();
    render(
      <SqlMonacoEditor
        value="SELECT 1;"
        onChange={vi.fn()}
        onRunShortcut={vi.fn()}
        onFormatShortcut={onFormatShortcut}
        tables={[]}
        ariaLabel="SQL query editor"
      />
    );
    act(() => harness.commands.format?.());
    expect(onFormatShortcut).toHaveBeenCalledTimes(1);
  });

  it('offers table, column, and keyword completions', () => {
    render(
      <SqlMonacoEditor
        value=""
        onChange={vi.fn()}
        onRunShortcut={vi.fn()}
        onFormatShortcut={vi.fn()}
        tables={[
          {
            name: 'users',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'user name', type: 'VARCHAR' },
            ],
          },
          { name: 'orders', columns: [{ name: 'id', type: 'BIGINT' }] },
        ]}
        ariaLabel="SQL query editor"
      />
    );
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

  it('disposes the completion provider when the editor disposes', () => {
    const { unmount } = render(
      <SqlMonacoEditor
        value="SELECT 1;"
        onChange={vi.fn()}
        onRunShortcut={vi.fn()}
        onFormatShortcut={vi.fn()}
        tables={[]}
        ariaLabel="SQL query editor"
      />
    );
    expect(harness.disposeCount).toBe(0);
    // Monaco fires onDidDispose when the editor tears down; React unmount of
    // <MonacoEditor> is what triggers it in the real library. Invoke the
    // captured callback to assert the host's cleanup runs.
    unmount();
    act(() => harness.didDispose?.());
    expect(harness.disposeCount).toBe(1);
  });
});
