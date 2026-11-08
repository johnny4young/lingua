/**
 * Shared `@monaco-editor/react` stand-in for the SQL editor tests. It renders
 * a textarea (`sql-query-editor-textarea`) and hands the host a fake editor
 * that records its commands, so a test can fire a chord or a cursor move.
 *
 *   vi.mock('@monaco-editor/react', async () =>
 *     (await import('../../__fixtures__/sqlMonacoMock')).sqlMonacoModule);
 */
import { useRef, useState } from 'react';
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
  /** Text the host inserted at the cursor through executeEdits. */
  edits: string[];
  /** Model text ahead of React, as right after a paste; null mirrors the rendered value. */
  modelValue: string | null;
  /** Types like Monaco: a native model event, outside React's event system, so React may render it later. */
  type: (text: string) => void;
  onCursor: Listener | null;
  /** Every decorations collection the host created, with what it last set. */
  decorations: Array<Array<{ range: unknown; options: Record<string, unknown> }>>;
  /** Offset the host last moved the cursor to. */
  movedTo: number | null;
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
  edits: [],
  modelValue: null,
  type: () => {},
  onCursor: null,
  decorations: [],
  movedTo: null,
  completionProvider: null,
};

export function resetSqlMonacoHarness(): void {
  sqlMonacoHarness.commands = new Map();
  sqlMonacoHarness.selectedRangeText = null;
  sqlMonacoHarness.cursorOffset = 0;
  sqlMonacoHarness.edits = [];
  sqlMonacoHarness.modelValue = null;
  sqlMonacoHarness.onCursor = null;
  sqlMonacoHarness.decorations = [];
  sqlMonacoHarness.movedTo = null;
  sqlMonacoHarness.completionProvider = null;
  sqlModels.clear();
}

/** Decorations currently set with `className`. */
export function sqlDecorationsWith(className: string): Array<{ range: unknown; options: Record<string, unknown> }> {
  return sqlMonacoHarness.decorations.flat().filter((decoration) => decoration.options['className'] === className);
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

type MockUri = { scheme: string; toString: () => string };

/** A model the host can switch between, as Monaco keeps one per URI. */
class MockModel {
  constructor(
    public text: string,
    public uri: MockUri
  ) {}
  getValueInRange = () => sqlMonacoHarness.selectedRangeText ?? '';
  getFullModelRange = () => ({});
  getOffsetAt = (position: { offset?: number }) => position.offset ?? sqlMonacoHarness.cursorOffset;
  getPositionAt = (offset: number) => {
    const before = this.text.slice(0, offset).split('\n');
    return { offset, lineNumber: before.length, column: before.at(-1)!.length + 1 };
  };
  dispose = () => {
    sqlModels.delete(this.uri.toString());
  };
}

const sqlModels = new Map<string, MockModel>();
let unkeyedModels = 0;

function MonacoEditor({
  defaultValue,
  onChange,
  onMount,
  options,
}: {
  defaultValue?: string;
  onChange?: (value: string | undefined) => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
  options?: { ariaLabel?: string };
}) {
  // Uncontrolled models, like Monaco's: only typing, executeEdits and setModel change the text.
  const [, setTick] = useState(0);
  const render = () => setTick((tick) => tick + 1);
  const modelRef = useRef<MockModel | null>(null);
  if (modelRef.current === null) {
    const id = ++unkeyedModels;
    modelRef.current = new MockModel(defaultValue ?? '', { scheme: 'inmemory', toString: () => `inmemory://model/${id}` });
  }
  const setText = (next: string) => {
    modelRef.current!.text = next;
    render();
  };
  sqlMonacoHarness.type = (next) => {
    setText(next);
    onChange?.(next);
  };
  const disposable = { dispose: () => {} };
  const editor = {
    getSelection: () => ({ __selection: true }),
    executeEdits: (source: string, edits: Array<{ text: string }>) => {
      if (source === 'sql-external') setText(edits[0]?.text ?? '');
      else sqlMonacoHarness.edits.push(...edits.map((edit) => edit.text));
      return true;
    },
    pushUndoStop: () => true,
    focus: () => {},
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    getModel: () => {
      const model = modelRef.current!;
      // Model text ahead of React, as right after a paste.
      return Object.assign(model, {
        getValue: () => sqlMonacoHarness.modelValue ?? model.text,
        setValue: (next: string) => {
          model.text = next;
          render();
        },
      });
    },
    setModel: (model: MockModel) => {
      modelRef.current = model;
      render();
    },
    setPosition: (position: { offset: number }) => {
      sqlMonacoHarness.movedTo = position.offset;
    },
    revealPositionInCenterIfOutsideViewport: () => {},
    addCommand: (chord: number, callback: () => void) => {
      sqlMonacoHarness.commands.set(chord, callback);
    },
    createDecorationsCollection: () => {
      const index = sqlMonacoHarness.decorations.push([]) - 1;
      return {
        set: (items: Array<{ range: unknown; options: Record<string, unknown> }>) => {
          sqlMonacoHarness.decorations[index] = items;
        },
      };
    },
    setScrollLeft: () => {},
    saveViewState: () => null,
    restoreViewState: () => {},
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
    Uri: { from: ({ scheme, path }: { scheme: string; path: string }) => ({ scheme, toString: () => `${scheme}:${path}` }) },
    editor: {
      defineTheme: vi.fn(),
      MouseTargetType: { GUTTER_GLYPH_MARGIN: 2 },
      getModel: (uri: MockUri) => sqlModels.get(uri.toString()) ?? null,
      getModels: () => [...sqlModels.values()],
      createModel: (text: string, _language: string, uri: MockUri) => {
        const model = new MockModel(text, uri);
        sqlModels.set(uri.toString(), model);
        return model;
      },
    },
    languages: {
      CompletionItemKind: { Function: 1, Struct: 5, Field: 4, Keyword: 17 },
      registerCompletionItemProvider: (
        _language: string,
        provider: (typeof sqlMonacoHarness)['completionProvider']
      ) => {
        sqlMonacoHarness.completionProvider = provider;
        return disposable;
      },
    },
  };
  // Monaco mounts once; a host that edits the model on mount must not loop.
  const mountedRef = useRef(false);
  if (!mountedRef.current) {
    mountedRef.current = true;
    onMount?.(editor, monaco);
  }
  const model = modelRef.current;
  return (
    <textarea
      data-testid="sql-query-editor-textarea"
      aria-label={options?.ariaLabel}
      value={model.text}
      onChange={(event) => {
        setText(event.target.value);
        onChange?.(event.target.value);
      }}
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
