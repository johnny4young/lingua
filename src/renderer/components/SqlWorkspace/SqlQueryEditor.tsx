/**
 * Center column: edit the active SQL query (Monaco on the `sql` language),
 * with the split Run, Cancel, format and a 500 ms debounced auto-save.
 *
 * Runs resolve here into a list of statements: the statement under the
 * cursor (Mod+Enter, toolbar Run, gutter Run), the selection
 * (Mod+Alt+Enter), every statement (Mod+Shift+Enter), or Explain. The
 * auto-save always persists the FULL buffer, never the part that ran.
 */

import { Wand2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useCommandListener } from '../../hooks/useCommandListener';
import { useWorkspaceRunTarget } from '../../hooks/useWorkspaceRunTarget';
import { formatNumber } from '../../i18n/formatNumber';
import { useUIStore } from '../../stores/uiStore';
import {
  MAX_QUERY_BYTES,
  utf8ByteLength,
  type SqlQueryV1,
} from '../../../shared/sqlWorkspace';
import { hasWhereClause, splitSqlStatements, statementAtOffset } from '../../../shared/sqlStatements';
import { getSqlQueryAutoSaveDebounceMs } from './sqlQueryEditorTiming';
import { SqlMonacoEditor, type SqlEditorCursor, type SqlRunContext } from './SqlMonacoEditor';
import { SqlRunMenu, type SqlRunMenuMode } from './SqlRunMenu';
import type { SqlSchemaTable } from './sqlExplorerModel';
import type { SqlEngineKind } from '../../../shared/sqlConnections';
import { sqlDialect } from '../../../shared/sqlDialect';

export interface SqlRunRequest {
  query: SqlQueryV1;
  mode: SqlRunMenuMode;
  statements: string[];
}

export interface SqlQueryEditorProps {
  query: SqlQueryV1;
  /**
   * Patches land via this callback (auto-save). The target query id is
   * passed explicitly so a debounced flush always lands on the query
   * the edit was typed into, even if the active query switched during
   * the debounce quiet window.
   */
  onPatch: (queryId: string, patch: Partial<SqlQueryV1>) => void;
  /** Run `statements` from `query` (which carries the full buffer). */
  onRun: (request: SqlRunRequest) => void;
  onCancel: () => void;
  /** Mod+S, or Mod+Shift+S when `as`. */
  onSave: (as: boolean) => void;
  /** This query is running. */
  isExecuting: boolean;
  /** Another query is running, so Run waits. */
  isBusy?: boolean;
  /**
   * Edit-in-editor insert signal. When `nonce` increments the editor
   * appends `text` to the current draft (on its own line when the draft
   * is non-empty) and schedules the usual debounced auto-save. A signal
   * object (rather than a bare string) lets the same table be inserted
   * twice in a row — the changing nonce is what the effect keys on.
   */
  insertSignal?: { text: string; nonce: number };
  /** A column-rail predicate to insert at the cursor, as WHERE or AND depending on the statement; `raw` text goes in as is. */
  predicateSignal?: { text: string; nonce: number; raw?: boolean };
  /**
   * Live session tables, threaded from the panel's
   * Explorer catalog. Fed to the Monaco completion provider so table names
   * autocomplete; empty until the first catalog refresh.
   */
  tables: ReadonlyArray<SqlSchemaTable>;
  /** The engine the query runs on; the formatter and completion follow it. Local when unset. */
  engine?: SqlEngineKind;
  /** Function names from a connection's catalog, for completion. */
  functions?: ReadonlyArray<string>;
  /**
   * Optional extra header control (the Ask-AI trigger). A slot
   * rather than a baked-in button so the editor stays AI-agnostic.
   */
  headerExtra?: ReactNode;
}

export function SqlQueryEditor({
  query,
  onPatch,
  onRun,
  onCancel,
  onSave,
  isExecuting,
  isBusy = false,
  insertSignal,
  predicateSignal,
  tables,
  engine,
  functions,
  headerExtra,
}: SqlQueryEditorProps) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState<string>(query.query);
  const lastInsertNonceRef = useRef<number>(insertSignal?.nonce ?? 0);
  const lastSavedRef = useRef<string>(query.query);
  const latestTextRef = useRef<string>(query.query);
  const latestOnPatchRef = useRef(onPatch);
  // The id of the query the pending draft was typed into,
  // captured whenever the draft diverges from the saved text. The
  // flush reads THIS captured id, not the live `query.id` prop, so a
  // switch before the debounce settles cannot redirect the patch onto
  // the newly-active query.
  const pendingTargetIdRef = useRef<string>(query.id);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizeBytes = utf8ByteLength(text);
  const overCap = sizeBytes > MAX_QUERY_BYTES;
  const statements = useMemo(() => splitSqlStatements(text), [text]);
  const [cursorInsert, setCursorInsert] = useState<{ text: string; nonce: number } | null>(null);
  const [cursor, setCursor] = useState<SqlEditorCursor>({ offset: 0, selectionStart: 0, selectionEnd: 0 });
  const cursorIndex = statementAtOffset(statements, cursor.offset)?.index ?? 0;
  const hasSelection = text.slice(cursor.selectionStart, cursor.selectionEnd).trim().length > 0;

  const flushPendingDraft = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const latestText = latestTextRef.current;
    if (latestText !== lastSavedRef.current) {
      latestOnPatchRef.current(pendingTargetIdRef.current, { query: latestText });
      lastSavedRef.current = latestText;
    }
  }, []);

  // Sync external query changes (different query selected, rename
  // didn't touch query text but selection change did). Compare ids
  // via the prop's id capture — the effect re-runs whenever the
  // store-driven query object changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- This prop-to-draft sync must run after the query-id cleanup has flushed the previous draft.
    setText(query.query);
    latestTextRef.current = query.query;
    lastSavedRef.current = query.query;
    pendingTargetIdRef.current = query.id;
  }, [query.id, query.query]);

  useEffect(() => {
    latestTextRef.current = text;
  }, [text]);

  useEffect(() => {
    latestOnPatchRef.current = onPatch;
  }, [onPatch]);

  // Edit-in-editor insert. Keyed on the signal nonce so re-inserting
  // the same table (identical text) still fires. Appends on a fresh
  // line when the draft already has content. The append flows through
  // `setText` → the controlled `value` prop → Monaco reconciles its
  // model, so no editor ref is needed. The debounce effect picks up the
  // resulting `text` change and auto-saves.
  useEffect(() => {
    if (insertSignal === undefined) return;
    if (insertSignal.nonce === lastInsertNonceRef.current) return;
    lastInsertNonceRef.current = insertSignal.nonce;
    if (insertSignal.text.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: this effect subscribes to an external imperative signal (the Edit-in-editor insert nonce) and folds it into the editor draft. The functional update reads the latest draft so concurrent typing is preserved.
    setText((current) => {
      const trimmed = current.replace(/\s+$/, '');
      return trimmed.length === 0
        ? insertSignal.text
        : `${trimmed}\n${insertSignal.text}`;
    });
  }, [insertSignal]);

  useEffect(() => {
    return () => {
      flushPendingDraft();
    };
  }, [query.id, flushPendingDraft]);

  // Auto-save debounce. Stable timer ref means rapid edits collapse
  // to one onPatch call after the user pauses for 500 ms. The flush
  // targets the captured `query.id` at schedule time so a switch
  // mid-debounce never lands the patch on the wrong query.
  useEffect(() => {
    if (text === lastSavedRef.current) return;
    const targetId = query.id;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      lastSavedRef.current = text;
      onPatch(targetId, { query: text });
    }, getSqlQueryAutoSaveDebounceMs());
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [text, onPatch, query.id]);

  // The query-id cleanup above flushes pending drafts on both unmount
  // and active-query switches, before the new query state is synced.

  const runMode = useCallback(
    (mode: SqlRunMenuMode, context: SqlRunContext) => {
      if (isExecuting || isBusy || overCap) return;
      const buffer = context.value ?? text;
      const bufferStatements = buffer === text ? statements : splitSqlStatements(buffer);
      let pieces: string[];
      if (mode === 'all') pieces = bufferStatements.map((statement) => statement.text);
      else if (mode === 'selection') {
        pieces = context.selectedText ? splitSqlStatements(context.selectedText).map((s) => s.text) : [];
      } else {
        const picked = statementAtOffset(bufferStatements, context.offset);
        pieces = picked ? [picked.statement.text] : [];
      }
      if (pieces.length === 0) return;
      // Flush the pending auto-save so the run and the store see the same full buffer.
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (buffer !== lastSavedRef.current) {
        lastSavedRef.current = buffer;
        onPatch(query.id, { query: buffer });
      }
      onRun({ query: { ...query, query: buffer }, mode, statements: pieces });
    },
    [isExecuting, isBusy, overCap, statements, text, query, onPatch, onRun]
  );
  const selectedText = useCallback(() => {
    const raw = text.slice(cursor.selectionStart, cursor.selectionEnd);
    return raw.trim().length > 0 ? raw : null;
  }, [text, cursor]);
  const runFromToolbar = useCallback(
    (mode: SqlRunMenuMode) => runMode(mode, { offset: cursor.offset, selectedText: selectedText() }),
    [runMode, cursor.offset, selectedText]
  );
  useWorkspaceRunTarget('sql', () => runFromToolbar('statement'));
  useCommandListener('workspace.save', (payload) => {
    if (payload.kind === 'sql') onSave(payload.as);
  });

  // A rail predicate joins the statement under the cursor: AND after its WHERE, else WHERE.
  const lastPredicateNonceRef = useRef(predicateSignal?.nonce ?? 0);
  useEffect(() => {
    if (!predicateSignal || predicateSignal.nonce === lastPredicateNonceRef.current) return;
    lastPredicateNonceRef.current = predicateSignal.nonce;
    if (predicateSignal.raw) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Folds an external insert signal into the editor, like insertSignal above.
      setCursorInsert({ text: predicateSignal.text, nonce: predicateSignal.nonce });
      return;
    }
    const picked = statementAtOffset(splitSqlStatements(latestTextRef.current), cursor.offset);
    const before = picked
      ? latestTextRef.current.slice(picked.statement.start, Math.min(cursor.offset, picked.statement.end))
      : '';
    const joiner = hasWhereClause(before) ? 'AND' : 'WHERE';
    const spacer = /\s$/.test(latestTextRef.current.slice(0, cursor.offset)) || cursor.offset === 0 ? '' : ' ';
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Folds an external insert signal into the editor, like insertSignal above.
    setCursorInsert({ text: `${spacer}${joiner} ${predicateSignal.text}`, nonce: predicateSignal.nonce });
  }, [predicateSignal, cursor.offset]);

  // Pretty-print via sql-formatter in the engine's language. Lazy-import
  // keeps the formatter out of the main chunk.
  const handleFormat = useCallback(async () => {
    if (overCap) return;
    try {
      const mod = await import('sql-formatter');
      const formatted = mod.format(text, {
        language: sqlDialect(engine).formatter,
        keywordCase: 'upper',
        tabWidth: 2,
      });
      setText(formatted);
    } catch (err) {
      // sql-formatter throws on syntactically-broken SQL. Push a
      // non-blocking notice — the editor stays in the user's text.
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'sqlWorkspace.editor.formatFailed',
        detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
      });
    }
  }, [text, overCap, engine]);

  return (
    <div
      data-testid="sql-query-editor"
      className="flex h-full min-w-0 flex-col bg-bg-base"
    >
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">
          {t('sqlWorkspace.editor.queryLabel')}
        </span>
        {statements.length > 0 ? (
          <span
            data-testid="sql-query-editor-statements"
            className="truncate font-mono text-eyebrow tabular-nums text-fg-subtle"
          >
            {t('sqlWorkspace.editor.statementInfo', {
              count: statements.length,
              index: Math.min(cursorIndex + 1, statements.length),
            })}
          </span>
        ) : null}
        <span
          className={`ml-auto shrink-0 font-mono text-eyebrow tabular-nums ${overCap ? 'text-error-fg' : 'text-fg-subtle'}`}
          data-testid="sql-query-editor-size"
          aria-live="polite"
        >
          {overCap
            ? t('sqlWorkspace.editor.sizeOverCap', {
                size: formatNumber(sizeBytes, i18n.language),
              })
            : t('sqlWorkspace.editor.sizeBytes', {
                size: formatNumber(sizeBytes, i18n.language),
              })}
        </span>
        {headerExtra}
        <button
          type="button"
          onClick={handleFormat}
          disabled={overCap || text.trim().length === 0}
          data-testid="sql-query-editor-format"
          aria-label={t('sqlWorkspace.editor.format')}
          title={t('sqlWorkspace.editor.format')}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel-alt hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Wand2 size={11} aria-hidden="true" />
          <span>{t('sqlWorkspace.editor.format')}</span>
        </button>
        <SqlRunMenu
          onRun={runFromToolbar}
          onCancel={onCancel}
          isExecuting={isExecuting}
          disabled={isBusy || overCap || statements.length === 0}
          hasSelection={hasSelection}
        />
      </header>
      <SqlMonacoEditor
        value={text}
        onChange={setText}
        onRunCommand={runMode}
        onCancelShortcut={onCancel}
        onSaveShortcut={onSave}
        onCursorChange={setCursor}
        statements={statements}
        runGlyphLabel={t('sqlWorkspace.run.statement')}
        onFormatShortcut={handleFormat}
        {...(cursorInsert ? { insertAtCursor: cursorInsert } : {})}
        tables={tables}
        {...(engine ? { engine } : {})}
        {...(functions ? { functions } : {})}
        ariaLabel={t('sqlWorkspace.editor.ariaLabel')}
      />
    </div>
  );
}
