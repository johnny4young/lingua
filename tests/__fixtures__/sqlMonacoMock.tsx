/**
 * Shared `@monaco-editor/react` stand-in for the SQL editor tests. It renders
 * a textarea (`sql-query-editor-textarea`) and hands the host a fake editor
 * that records its commands, so a test can fire a chord or a cursor move.
 *
 *   vi.mock('@monaco-editor/react', async () =>
 *     (await import('../../__fixtures__/sqlMonacoMock')).sqlMonacoModule);
 */
import { vi } from 'vitest';

type Listener = (event: unknown) => void;

export const SQL_KEYMOD = { CtrlCmd: 1 << 11, Shift: 1 << 10, Alt: 1 << 9 };
export const SQL_KEYCODE = { Enter: 3, KeyF: 36, KeyS: 49, Period: 87 };
export const SQL_CHORD = {
  statement: SQL_KEYMOD.CtrlCmd | SQL_KEYCODE.Enter,
  selection: SQL_KEYMOD.CtrlCmd | SQL_KEYMOD.Alt | SQL_KEYCODE.Enter,
  all: SQL_KEYMOD.CtrlCmd | SQL_KEYMOD.Shift | SQL_KEYCODE.Enter,
  cancel: SQL_KEYMOD.CtrlCmd | SQL_KEYCODE.Period,
  save: SQL_KEYMOD.CtrlCmd | SQL_KEYCODE.KeyS,
  saveAs: SQL_KEYMOD.CtrlCmd | SQL_KEYMOD.Shift | SQL_KEYCODE.KeyS,
  format: SQL_KEYMOD.Shift | SQL_KEYMOD.Alt | SQL_KEYCODE.KeyF,
};

export const sqlMonacoHarness: {
  commands: Map<number, () => void>;
  selectedRangeText: string | null;
  cursorOffset: number;
  /** Model text ahead of React, as right after a paste; null mirrors the rendered value. */
  modelValue: string | null;
  onCursor: Listener | null;
  completionProvider:
    | {
        provideCompletionItems: (
          model: unknown,
          position: unknown
        ) => { suggestions: Array<{ label: string; kind: number; insertText: string }> };
      }
    | null;
} = {
  commands: new Map(),
  selectedRangeText: null,
  cursorOffset: 0,
  modelValue: null,
  onCursor: null,
  completionProvider: null,
};

export function resetSqlMonacoHarness(): void {
  sqlMonacoHarness.commands = new Map();
  sqlMonacoHarness.selectedRangeText = null;
  sqlMonacoHarness.cursorOffset = 0;
  sqlMonacoHarness.modelValue = null;
  sqlMonacoHarness.onCursor = null;
  sqlMonacoHarness.completionProvider = null;
}

/** Fires a registered chord, as Monaco would on the key press. */
export function pressSqlChord(name: keyof typeof SQL_CHORD): void {
  sqlMonacoHarness.commands.get(SQL_CHORD[name])?.();
}

/** Moves the fake cursor and reports it, with an optional selection range. */
export function moveSqlCursor(offset: number, selection?: { start: number; end: number }): void {
  sqlMonacoHarness.cursorOffset = offset;
  sqlMonacoHarness.onCursor?.({
    selection: {
      getPosition: () => ({ offset }),
      getStartPosition: () => ({ offset: selection?.start ?? offset }),
      getEndPosition: () => ({ offset: selection?.end ?? offset }),
    },
  });
}

function MonacoEditor({
  value,
  onChange,
  onMount,
  options,
}: {
  value: string;
  onChange?: (value: string | undefined) => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
  options?: { ariaLabel?: string };
}) {
  const disposable = { dispose: () => {} };
  const editor = {
    getSelection: () => (sqlMonacoHarness.selectedRangeText !== null ? { __selection: true } : null),
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    getModel: () => ({
      getValueInRange: () => sqlMonacoHarness.selectedRangeText ?? '',
      getValue: () => sqlMonacoHarness.modelValue ?? undefined,
      getOffsetAt: (position: { offset?: number }) => position.offset ?? sqlMonacoHarness.cursorOffset,
    }),
    addCommand: (chord: number, callback: () => void) => {
      sqlMonacoHarness.commands.set(chord, callback);
    },
    createDecorationsCollection: () => ({ set: () => {} }),
    setScrollLeft: () => {},
    onDidChangeCursorSelection: (listener: Listener) => {
      sqlMonacoHarness.onCursor = listener;
      return disposable;
    },
    onMouseDown: () => disposable,
    onDidDispose: () => {},
  };
  const monaco = {
    KeyMod: SQL_KEYMOD,
    KeyCode: SQL_KEYCODE,
    Range: class {},
    editor: { defineTheme: vi.fn(), MouseTargetType: { GUTTER_GLYPH_MARGIN: 2 } },
    languages: {
      CompletionItemKind: { Struct: 5, Field: 4, Keyword: 17 },
      registerCompletionItemProvider: (
        _language: string,
        provider: (typeof sqlMonacoHarness)['completionProvider']
      ) => {
        sqlMonacoHarness.completionProvider = provider;
        return disposable;
      },
    },
  };
  onMount?.(editor, monaco);
  return (
    <textarea
      data-testid="sql-query-editor-textarea"
      aria-label={options?.ariaLabel}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          pressSqlChord(event.shiftKey ? 'all' : event.altKey ? 'selection' : 'statement');
        }
      }}
    />
  );
}

// `monaco.ts` (reached through configureMonaco) calls `loader.config(...)`.
export const sqlMonacoModule = { default: MonacoEditor, loader: { config: () => {} } };
