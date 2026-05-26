/**
 * RL-097 Slice 2 — Center column: edit the active SQL query
 * (textarea editor, Run, format) with auto-save + Cmd+Enter run
 * shortcut.
 *
 * Folds wired here:
 *
 *   - **A**: Cmd/Ctrl+Enter while focus is inside the query editor
 *     fires the Run handler. Mirrors the HTTP workspace `Cmd+Enter`
 *     muscle memory + the scratchpad run shortcut.
 *   - **B**: pretty-print SQL via `sql-formatter` (lazy-imported so
 *     the formatter ~30 KB chunk lands separately). Triggered by a
 *     button in the editor toolbar. Reformat on save would be too
 *     aggressive — single-action button keeps it intentional.
 *   - **D-mirror**: every keystroke debounced 500 ms auto-saves via
 *     `onPatch` — no explicit Save button. Mirrors HTTP Slice 1 fold D.
 *
 * Intentionally a plain `<textarea>` instead of Monaco — Slice 2
 * keeps the bundle weight focused on DuckDB-WASM (~7 MiB). A Monaco
 * SQL editor with IntelliSense is Slice 3+ territory.
 */

import { Loader2, Play, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import {
  MAX_QUERY_BYTES,
  utf8ByteLength,
  type SqlQueryV1,
} from '../../../shared/sqlWorkspace';
import { getSqlQueryAutoSaveDebounceMs } from './sqlQueryEditorTiming';

export interface SqlQueryEditorProps {
  query: SqlQueryV1;
  /** Patches land via this callback (auto-save). */
  onPatch: (patch: Partial<SqlQueryV1>) => void;
  /** Run the current query. Caller disables during in-flight. */
  onRun: (query: SqlQueryV1) => void;
  isExecuting: boolean;
}

export function SqlQueryEditor({
  query,
  onPatch,
  onRun,
  isExecuting,
}: SqlQueryEditorProps) {
  const { t } = useTranslation();
  const [text, setText] = useState<string>(query.query);
  const lastSavedRef = useRef<string>(query.query);
  const latestTextRef = useRef<string>(query.query);
  const latestOnPatchRef = useRef(onPatch);
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
      latestOnPatchRef.current({ query: latestText });
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
  }, [query.id, query.query]);

  useEffect(() => {
    latestTextRef.current = text;
  }, [text]);

  useEffect(() => {
    latestOnPatchRef.current = onPatch;
  }, [onPatch]);

  useEffect(() => {
    return () => {
      flushPendingDraft();
    };
  }, [query.id, flushPendingDraft]);

  // Auto-save debounce. Stable timer ref means rapid edits collapse
  // to one onPatch call after the user pauses for 500 ms.
  useEffect(() => {
    if (text === lastSavedRef.current) return;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      lastSavedRef.current = text;
      onPatch({ query: text });
    }, getSqlQueryAutoSaveDebounceMs());
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [text, onPatch]);

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
      onPatch({ query: text });
    }
    onRun({ ...query, query: text });
  }, [isExecuting, overCap, text, query, onPatch, onRun]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd+Enter (macOS) / Ctrl+Enter (other) → Run.
      const cmdOrCtrl = event.metaKey || event.ctrlKey;
      if (cmdOrCtrl && event.key === 'Enter') {
        event.preventDefault();
        handleRun();
      }
    },
    [handleRun]
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
      className="flex h-full min-w-0 flex-col"
    >
      <header className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          {t('sqlWorkspace.editor.queryLabel')}
        </span>
        <span
          className={`ml-auto text-[10px] tabular-nums ${overCap ? 'text-rose-500' : 'text-muted'}`}
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
        <button
          type="button"
          onClick={handleFormat}
          disabled={overCap || text.trim().length === 0}
          data-testid="sql-query-editor-format"
          aria-label={t('sqlWorkspace.editor.format')}
          title={t('sqlWorkspace.editor.format')}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-[11px] font-medium text-muted hover:border-border-strong hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
          className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-700 hover:border-emerald-500 hover:bg-emerald-500/20 dark:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isExecuting ? (
            <Loader2 size={11} aria-hidden="true" className="animate-spin" />
          ) : (
            <Play size={11} aria-hidden="true" />
          )}
          <span>{t('sqlWorkspace.editor.run')}</span>
          <span className="ml-1 hidden text-[10px] text-emerald-700/70 dark:text-emerald-300/70 sm:inline">
            {runShortcutHint}
          </span>
        </button>
      </header>
      <textarea
        data-testid="sql-query-editor-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        placeholder={t('sqlWorkspace.editor.placeholder')}
        className="min-h-0 flex-1 resize-none border-0 bg-background px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-fg-subtle focus-visible:outline-none"
      />
    </div>
  );
}
