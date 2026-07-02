/**
 * RL-097 Slice 3 — Monaco-backed SQL query editor host.
 *
 * Replaces the SQL workspace's plain `<textarea>` with a controlled
 * `@monaco-editor/react` editor on the built-in `sql` language. This is
 * a Free-tier, renderer-only surface — no IPC, no entitlement.
 *
 * INVARIANTS:
 *
 *   - **editorAccess isolation.** Unlike `<CodeEditor>`, this host must
 *     NEVER call `setActiveEditor(...)` from `runtime/editorAccess`. The
 *     SQL editor is a satellite surface; binding it to the global active-
 *     editor registry would make the persistent status bar, cursor
 *     readouts, and the keyboard-shortcut bus point at the SQL buffer
 *     instead of the main code editor.
 *
 *   - **Controlled value contract.** `value` is the single source of
 *     truth, owned by the parent. `@monaco-editor/react` reconciles the
 *     model when `value` changes externally (e.g. schema-browser insert,
 *     format result) and does NOT re-fire `onChange` for that
 *     library-driven update, so there is no echo loop. We never call
 *     `editor.setValue` on every render — the library owns model sync.
 *
 *   - **Provider disposal.** The `sql` completion provider (fold A) and
 *     the two keybinding commands (folds C + E) are registered in
 *     `onMount` and disposed on unmount via the editor's
 *     `onDidDispose` hook — no leak across SQL-workspace mounts.
 *
 * Folds wired here:
 *   - **A**: `sql` completion provider over the live table names, their
 *     column names (with the SQL type shown as the completion detail),
 *     and a small common-keyword set. The columns arrive from the panel's
 *     single `information_schema.columns` probe; the same latest-value ref
 *     that keeps table names fresh keeps columns fresh too.
 *   - **B**: tuned editor options (line numbers on, no minimap, no word
 *     wrap, 2-space tabs, line highlight, no overview ruler).
 *   - **C**: Shift+Alt+F → `onFormatShortcut()`.
 *   - **E**: Cmd/Ctrl+Enter → `onRunShortcut({ selectedText })` where
 *     `selectedText` is the current non-empty selection text or null.
 */

import MonacoEditor, {
  type Monaco,
  type OnMount,
} from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { configureMonaco } from '../../monaco';
import { defineCustomThemes } from '../Editor/editorThemes';
import { getSatelliteEditorOptions } from '../Editor/editorOptions';
import { quoteSqlIdentifier } from './sqlResultFormatters';

// Ensure the worker environment + the `sql` contribution are registered
// before any editor mounts (idempotent; shared with `<CodeEditor>`).
configureMonaco();

type EditorInstance = Parameters<OnMount>[0];

// Mirror `goCompletions.ts`: derive the completion-provider param types from
// the Monaco namespace so the inline provider object below type-checks without
// `any` on `model` / `position`.
type SqlCompletionProvider = Parameters<
  Monaco['languages']['registerCompletionItemProvider']
>[1];
type ProvideCompletionItems = NonNullable<
  SqlCompletionProvider['provideCompletionItems']
>;
type SqlCompletionModel = Parameters<ProvideCompletionItems>[0];
type SqlCompletionPosition = Parameters<ProvideCompletionItems>[1];

/**
 * Common SQL keywords surfaced as completion items alongside the live
 * session table names. Intentionally a small, dialect-agnostic set —
 * Monaco's word-based suggestions already cover identifiers the user
 * has typed; this just primes the obvious statement scaffolding.
 */
const SQL_KEYWORD_SUGGESTIONS: readonly string[] = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'DISTINCT',
  'AS',
  'ON',
  'AND',
  'OR',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE TABLE',
  'DROP TABLE',
  'WITH',
  'UNION',
  'UNION ALL',
];

/**
 * A column name that is a plain lower/upper identifier can be inserted
 * verbatim (`table.col`); anything else (spaces, quotes, leading digit,
 * punctuation) gets a quoted identifier so the completion stays valid.
 */
const SAFE_BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SqlMonacoEditorProps {
  /**
   * Controlled buffer text. The parent owns this; the editor reconciles
   * its model when the value changes externally without echoing
   * `onChange` for that library-driven update.
   */
  value: string;
  /** Fired on every user edit with the full buffer text. */
  onChange: (value: string) => void;
  /**
   * Cmd/Ctrl+Enter (fold E). `selectedText` is the current non-empty
   * selection text, or `null` when there is no selection — the parent
   * decides whether to run the selection or the full buffer.
   */
  onRunShortcut: (opts: { selectedText: string | null }) => void;
  /** Shift+Alt+F (fold C) — pretty-print the SQL. */
  onFormatShortcut: () => void;
  /**
   * Live session tables (fold A). Read through a ref inside the
   * completion provider so newly-introspected tables appear without
   * re-registering the provider. Each table's optional `columns` (name +
   * SQL type) feed column-name completion items alongside the table names.
   */
  tables: ReadonlyArray<{
    name: string;
    columns?: ReadonlyArray<{ name: string; type: string }>;
  }>;
  /** Accessible name for the editor textarea. */
  ariaLabel: string;
}

export function SqlMonacoEditor({
  value,
  onChange,
  onRunShortcut,
  onFormatShortcut,
  tables,
  ariaLabel,
}: SqlMonacoEditorProps) {
  const editorTheme = useSettingsStore((state) => state.editorTheme);
  const fontSize = useSettingsStore((state) => state.fontSize);
  const fontFamily = useSettingsStore((state) => state.fontFamily);

  const editorRef = useRef<EditorInstance | null>(null);

  // Register the custom Lingua/preset themes on the Monaco singleton
  // before mount. `<CodeEditor>` does the same in its own beforeMount;
  // doing it here too means the SQL workspace renders the selected theme
  // even when it is the FIRST editor surface mounted in the session
  // (otherwise Monaco falls back to a built-in when `editorTheme` names
  // an as-yet-undefined custom theme like `lingua-dark`).
  const handleBeforeMount = useCallback((monaco: Monaco) => {
    defineCustomThemes(monaco);
  }, []);

  // Latest-tables ref so the completion provider (registered once in
  // onMount) always reads the current `tables` prop. Updating the ref is
  // cheap and never re-registers the provider.
  const tablesRef = useRef(tables);
  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  // Latest-callback refs so the keybinding commands (also registered once
  // in onMount) always call the current handlers without re-mounting.
  const onRunShortcutRef = useRef(onRunShortcut);
  const onFormatShortcutRef = useRef(onFormatShortcut);
  useEffect(() => {
    onRunShortcutRef.current = onRunShortcut;
  }, [onRunShortcut]);
  useEffect(() => {
    onFormatShortcutRef.current = onFormatShortcut;
  }, [onFormatShortcut]);

  const handleMount = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor;
    // INVARIANT: do NOT call setActiveEditor here — this surface stays
    // out of the global editor-access registry on purpose.

    const disposables: { dispose: () => void }[] = [];

    // Fold E — Cmd/Ctrl+Enter runs the selection (when non-empty) or the
    // full buffer. addCommand returns a binding id string, not a
    // disposable, so the command is torn down with the editor itself.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      const raw =
        selection && model ? model.getValueInRange(selection) : '';
      const selectedText = raw.trim().length > 0 ? raw : null;
      onRunShortcutRef.current({ selectedText });
    });

    // Fold C — Shift+Alt+F formats.
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      () => {
        onFormatShortcutRef.current();
      }
    );

    // Fold A — `sql` completion provider: live table names + common
    // keywords. Disposed on unmount via onDidDispose below. (Column-name
    // completion is out of scope — see file header.)
    const completionProvider: SqlCompletionProvider = {
      provideCompletionItems: (
        completionModel: SqlCompletionModel,
        position: SqlCompletionPosition
      ) => {
        const word = completionModel.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const tableSuggestions = tablesRef.current.map((table) => ({
          label: table.name,
          kind: monaco.languages.CompletionItemKind.Struct,
          insertText: quoteSqlIdentifier(table.name),
          detail: 'table',
          range,
        }));
        // Column suggestions, deduped by name (case-insensitive). A column
        // can live in more than one table; the first occurrence's type wins
        // for the detail label and we note the extra owners. Simple bare
        // identifiers insert unquoted for a clean `table.col`; anything with
        // spaces/quotes/reserved shapes falls back to a quoted identifier.
        const columnDetails = new Map<
          string,
          { label: string; type: string; tables: string[] }
        >();
        for (const table of tablesRef.current) {
          for (const column of table.columns ?? []) {
            const key = column.name.toLowerCase();
            const existing = columnDetails.get(key);
            if (existing) {
              if (!existing.tables.includes(table.name)) {
                existing.tables.push(table.name);
              }
            } else {
              columnDetails.set(key, {
                label: column.name,
                type: column.type,
                tables: [table.name],
              });
            }
          }
        }
        const columnSuggestions = Array.from(columnDetails.values()).map(
          (column) => ({
            label: column.label,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: SAFE_BARE_IDENTIFIER.test(column.label)
              ? column.label
              : quoteSqlIdentifier(column.label),
            detail:
              column.tables.length > 1
                ? `${column.type} · ${column.tables.join(', ')}`
                : `${column.type} · ${column.tables[0]}`,
            range,
          })
        );
        const keywordSuggestions = SQL_KEYWORD_SUGGESTIONS.map((keyword) => ({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          range,
        }));
        return {
          suggestions: [
            ...tableSuggestions,
            ...columnSuggestions,
            ...keywordSuggestions,
          ],
        };
      },
    };
    disposables.push(
      monaco.languages.registerCompletionItemProvider('sql', completionProvider)
    );

    // Tear down the registered providers when the editor disposes. The
    // editor/model lifecycle itself is owned by `<MonacoEditor>`.
    editor.onDidDispose(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      editorRef.current = null;
    });
  }, []);

  return (
    <div className="min-h-0 flex-1" data-testid="sql-query-editor-monaco">
      <MonacoEditor
        height="100%"
        language="sql"
        value={value}
        theme={editorTheme}
        beforeMount={handleBeforeMount}
        onChange={(next) => {
          if (next !== undefined) onChange(next);
        }}
        onMount={handleMount}
        options={getSatelliteEditorOptions({ fontSize, fontFamily, ariaLabel })}
      />
    </div>
  );
}
