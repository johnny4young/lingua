/**
 * RL-097 Slice 2 + Slice 3 — Center column: edit the active SQL query
 * (Monaco editor on the `sql` language as of Slice 3, Run, format) with
 * auto-save + Cmd+Enter run shortcut.
 *
 * Folds wired here:
 *
 *   - **A** (Slice 2): Cmd/Ctrl+Enter fires the Run handler. As of
 *     Slice 3 (fold E below) it runs the SELECTION when non-empty, else
 *     the full query. Mirrors the HTTP workspace `Cmd+Enter` muscle
 *     memory + the scratchpad run shortcut.
 *   - **B**: pretty-print SQL via `sql-formatter` (lazy-imported so
 *     the formatter ~30 KB chunk lands separately). Triggered by a
 *     toolbar button OR Shift+Alt+F inside the editor (Slice 3 fold C).
 *     Reformat on save would be too aggressive — explicit action only.
 *   - **D-mirror**: every keystroke debounced 500 ms auto-saves via
 *     `onPatch` — no explicit Save button. Mirrors HTTP Slice 1 fold D.
 *
 * Slice 3 swaps the Slice 2 `<textarea>` for `<SqlMonacoEditor>` (folds
 * A/B/C/E live in that host). The auto-save debounce, RQ-02 id-pinning,
 * byte-cap, and schema-browser insert (via the controlled `value`) are
 * preserved exactly — the editor's `text` state stays the source of
 * truth and the Monaco host is fully controlled by it.
 */

import { Loader2, Play, Wand2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import {
  MAX_QUERY_BYTES,
  utf8ByteLength,
  type SqlQueryV1,
} from '../../../shared/sqlWorkspace';
import { getSqlQueryAutoSaveDebounceMs } from './sqlQueryEditorTiming';
import { SqlMonacoEditor } from './SqlMonacoEditor';
import type { SqlSchemaTable } from './SqlSchemaBrowser';

export interface SqlQueryEditorProps {
  query: SqlQueryV1;
  /**
   * Patches land via this callback (auto-save). The target query id is
   * passed explicitly so a debounced flush always lands on the query
   * the edit was typed into, even if the active query switched during
   * the debounce quiet window (RQ-02).
   */
  onPatch: (queryId: string, patch: Partial<SqlQueryV1>) => void;
  /** Run the current query. Caller disables during in-flight. */
  onRun: (query: SqlQueryV1) => void;
  isExecuting: boolean;
  /**
   * Schema-browser insert signal. When `nonce` increments the editor
   * appends `text` to the current draft (on its own line when the draft
   * is non-empty) and schedules the usual debounced auto-save. A signal
   * object (rather than a bare string) lets the same table be inserted
   * twice in a row — the changing nonce is what the effect keys on.
   */
  insertSignal?: { text: string; nonce: number };
  /**
   * Slice 3 fold A — live session tables, threaded from the panel's
   * schema browser. Fed to the Monaco completion provider so table names
   * autocomplete. Empty until the user runs a `SHOW TABLES` refresh.
   */
  tables: ReadonlyArray<SqlSchemaTable>;
  /**
   * T19 — optional extra header control (the Ask-AI trigger). A slot
   * rather than a baked-in button so the editor stays AI-agnostic.
   */
  headerExtra?: ReactNode;
}

export function SqlQueryEditor({
  query,
  onPatch,
  onRun,
  isExecuting,
  insertSignal,
  tables,
  headerExtra,
}: SqlQueryEditorProps) {
  const { t } = useTranslation();
  const [text, setText] = useState<string>(query.query);
  const lastInsertNonceRef = useRef<number>(insertSignal?.nonce ?? 0);
  const lastSavedRef = useRef<string>(query.query);
  const latestTextRef = useRef<string>(query.query);
  const latestOnPatchRef = useRef(onPatch);
  // RQ-02 — the id of the query the pending draft was typed into,
  // captured whenever the draft diverges from the saved text. The
  // flush reads THIS captured id, not the live `query.id` prop, so a
  // switch before the debounce settles cannot redirect the patch onto
  // the newly-active query.
  const pendingTargetIdRef = useRef<string>(query.id);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizeBytes = utf8ByteLength(text);
  const overCap = sizeBytes > MAX_QUERY_BYTES;

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

  // Schema-browser insert. Keyed on the signal nonce so re-inserting
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: this effect subscribes to an external imperative signal (the schema browser's table-insert nonce) and folds it into the editor draft. The functional update reads the latest draft so concurrent typing is preserved.
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
  // mid-debounce never lands the patch on the wrong query (RQ-02).
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

  const handleRun = useCallback(() => {
    if (isExecuting) return;
    if (overCap) return;
    // Flush any pending auto-save synchronously so the Run sees the
    // latest text (the user might press Cmd+Enter <500 ms after the
    // last keystroke).
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (text !== lastSavedRef.current) {
      lastSavedRef.current = text;
      onPatch(query.id, { query: text });
    }
    onRun({ ...query, query: text });
  }, [isExecuting, overCap, text, query, onPatch, onRun]);

  // Slice 3 fold E — Cmd/Ctrl+Enter inside the editor runs the SELECTION
  // when it is non-empty, else the full query. The auto-save always
  // flushes (and persists) the FULL `text` — never the selection — so a
  // partial run never truncates the saved query. The toolbar Run button
  // keeps calling `handleRun` (full query) unchanged.
  const handleRunWithSelection = useCallback(
    ({ selectedText }: { selectedText: string | null }) => {
      if (isExecuting) return;
      if (overCap) return;
      // Flush the pending auto-save of the FULL text synchronously so the
      // persisted query stays the whole buffer even on a selection run.
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (text !== lastSavedRef.current) {
        lastSavedRef.current = text;
        onPatch(query.id, { query: text });
      }
      const runText =
        selectedText !== null && selectedText.trim().length > 0
          ? selectedText
          : text;
      onRun({ ...query, query: runText });
    },
    [isExecuting, overCap, text, query, onPatch, onRun]
  );

  // Fold B — pretty-print via sql-formatter. Lazy-import keeps the
  // formatter out of the main chunk. The dialect default `'duckdb'`
  // exists since sql-formatter 13; older versions fall back to
  // `'sql'` (no DuckDB-specific keywords but acceptable).
  const handleFormat = useCallback(async () => {
    if (overCap) return;
    try {
      const mod = await import('sql-formatter');
      const formatted = mod.format(text, {
        language: 'duckdb',
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
  }, [text, overCap]);

  // Show the keyboard shortcut hint contextually per platform. Same
  // helper signature as `<HttpRequestEditor>` for consistency.
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform ?? '');
  const runShortcutHint = isMac ? '⌘ + ↵' : 'Ctrl + ↵';

  return (
    <div
      data-testid="sql-query-editor"
      className="flex h-full min-w-0 flex-col bg-bg-base"
    >
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">
          {t('sqlWorkspace.editor.queryLabel')}
        </span>
        <span
          className={`ml-auto font-mono text-eyebrow tabular-nums ${overCap ? 'text-error-fg' : 'text-fg-subtle'}`}
          data-testid="sql-query-editor-size"
          aria-live="polite"
        >
          {overCap
            ? t('sqlWorkspace.editor.sizeOverCap', {
                size: sizeBytes.toLocaleString(),
              })
            : t('sqlWorkspace.editor.sizeBytes', {
                size: sizeBytes.toLocaleString(),
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
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel-alt hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Wand2 size={11} aria-hidden="true" />
          <span>{t('sqlWorkspace.editor.format')}</span>
        </button>
        <button
          type="button"
          onClick={handleRun}
          disabled={isExecuting || overCap || text.trim().length === 0}
          data-testid="sql-query-editor-run"
          aria-label={t('sqlWorkspace.editor.run')}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-success-fg bg-success-fg px-2.5 text-body-sm font-semibold text-bg-base transition-colors hover:bg-success-border hover:border-success-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isExecuting ? (
            <Loader2 size={11} aria-hidden="true" className="animate-spin" />
          ) : (
            <Play size={11} aria-hidden="true" />
          )}
          <span>{t('sqlWorkspace.editor.run')}</span>
          <span className="ml-1 hidden font-mono text-eyebrow opacity-80 sm:inline">
            {runShortcutHint}
          </span>
        </button>
      </header>
      <SqlMonacoEditor
        value={text}
        onChange={setText}
        onRunShortcut={handleRunWithSelection}
        onFormatShortcut={handleFormat}
        tables={tables}
        ariaLabel={t('sqlWorkspace.editor.ariaLabel')}
      />
    </div>
  );
}
