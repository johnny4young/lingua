/**
 * RL-043 Slice A — Single code-cell row.
 *
 * Layout:
 *   - Header: language badge + cell index + status pill + action row
 *     (Run cell / Move up / Move down / Delete cell).
 *   - Body: active Monaco editor, or a cheap static colorized preview.
 *   - Outputs: stdout (foreground) + stderr (error tone) inline below
 *     the source.
 *
 * Slice G promotes code cells to a mount-virtualized Monaco editor — the
 * surface contract (source string, language, run handler) stays unchanged.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Play,
  Trash2,
} from 'lucide-react';
import {
  NOTEBOOK_CELL_LANGUAGES,
  type NotebookCellLanguage,
  type NotebookCodeCellV1,
} from '../../../shared/notebook';
import type { NotebookCellRunStatus } from '../../stores/notebookStore';
import { detectAutoTable, type RichOutputTable } from '../../../shared/richOutput';
import { RichTableGrid } from '../Console/RichTableGrid';
import { cn } from '../../utils/cn';
import { languageBadgeTone, languageLabel } from '../../utils/languageMeta';
import { ResultHeader } from '../ui/ResultHeader';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';
import { getNotebookCellAutoSaveDebounceMs } from './notebookCellEditorTiming';
import { NotebookCellEditor } from './NotebookCellEditor';
import { isNotebookRunnableLanguage } from '../../runtime/notebookSession';
import { ExplainErrorButton } from '../AI/ExplainErrorButton';
import { useEntitlement } from '../../hooks/useEntitlement';

export interface NotebookCodeCellRowProps {
  readonly cell: NotebookCodeCellV1;
  readonly cellIndex: number;
  readonly status: NotebookCellRunStatus;
  /**
   * FASE 4 — last-run latency in ms (fractional). Appended to the
   * header StatusBadge (" · 1.2 ms") and the output meta. Omitted
   * until the cell has run (transient store state, reset on reload).
   */
  readonly durationMs?: number;
  /**
   * FASE 4 — inter-cell variable flow surfaced as header chips:
   * `uses` (identifiers consumed from earlier cells) and `produces`
   * (top-level declarations this run added to the sandbox).
   */
  readonly varFlow?: {
    readonly uses: ReadonlyArray<string>;
    readonly produces: ReadonlyArray<string>;
  };
  /**
   * Signal-Slate — the Jupyter `[N]` execution-order stamp for this
   * cell (null until it has run). Rendered in the header next to the
   * status chip, mirroring Jupyter's `In [N]:` gutter.
   */
  readonly executionOrder?: number | null;
  /**
   * Signal-Slate — true when this is the active cell (keyboard target).
   * Drives the left accent bar + the Command/Edit mode label.
   */
  readonly isActive: boolean;
  /**
   * RL-043 Slice (Monaco cells) — command-mode "enter edit" signal. The
   * view bumps a `{ cellId, nonce }` request (Jupyter Enter / run-and-
   * advance / insert-below); when this cell's nonce changes the row mounts
   * its Monaco editor. `null` when no request targets this cell. The nonce
   * (not a boolean) lets a repeat-Enter on the already-active cell re-arm.
   */
  readonly editRequestNonce?: number | null;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly disabled: boolean;
  /** Mark this cell active (mouse / focus). */
  onActivate: (cellId: string) => void;
  onSourceChange: (cellId: string, source: string) => void;
  onRunCell: (cellId: string) => void;
  /**
   * Jupyter-parity keybind — `Shift+Enter` runs the cell then moves
   * focus to the next cell (creating one when this is the last). Falls
   * back to a plain in-place run when not provided.
   */
  onRunAndAdvance?: (cellId: string) => void;
  /**
   * Jupyter-parity keybind — `Alt+Enter` runs the cell then inserts a
   * fresh code cell directly below + focuses it. Falls back to a plain
   * in-place run when not provided.
   */
  onRunAndInsertBelow?: (cellId: string) => void;
  onMoveUp: (cellId: string) => void;
  onMoveDown: (cellId: string) => void;
  onDelete: (cellId: string) => void;
  /** RL-043 Slice C — change this cell's language via the header
   * selector (JavaScript ↔ TypeScript; Python is shown but disabled). */
  onLanguageChange: (cellId: string, language: NotebookCellLanguage) => void;
}

/**
 * FASE 4 — the per-cell run status maps onto a canonical
 * `<StatusBadge>` tone, used BOTH in the cell header (replacing the
 * old bespoke pill) and in the OUTPUT-region ResultHeader. `ok`/`error`
 * get the friendlier "Success"/"Error" copy in the output header;
 * `stopped` reads as a quiet warning; `running` never reaches the
 * output header (we omit it while a cell runs) but DOES render in the
 * cell header so the spinner-equivalent "Running" state stays visible.
 * Token-only — no hardcoded emerald/rose; the badge tones resolve in
 * both themes.
 */
const STATUS_BADGE_TONE: Record<NotebookCellRunStatus, StatusBadgeTone> = {
  idle: 'neutral',
  running: 'info',
  ok: 'success',
  error: 'error',
  stopped: 'warning',
};

/**
 * FASE 4 — render the per-cell latency as a compact mono suffix
 * (" · 1.2 ms"), matching the proto's `StatusBadge … · 1.2 ms`. One
 * decimal keeps sub-millisecond runs legible without noisy precision.
 * `performance.now()` deltas are already in ms.
 */
function formatLatencyMs(ms: number): string {
  return ms >= 100 ? Math.round(ms).toString() : ms.toFixed(1);
}

function statusKey(status: NotebookCellRunStatus): string {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'running':
      return 'running';
    case 'ok':
      return 'ok';
    case 'error':
      return 'error';
    case 'stopped':
      return 'stopped';
  }
}

/**
 * The OUTPUT-region ResultHeader prefers the friendlier
 * `notebook.status.success` / `notebook.status.errored` copy for the
 * two terminal states a reader actually sees there; everything else
 * reuses the existing `notebook.status.*` label so we don't duplicate
 * strings.
 */
function outputStatusKey(status: NotebookCellRunStatus): string {
  switch (status) {
    case 'ok':
      return 'success';
    case 'error':
      return 'errored';
    default:
      return statusKey(status);
  }
}

/**
 * T3 — try to upgrade a plain-text output to a rich table. Only a
 * string that trims to a JSON array of homogeneous plain objects
 * qualifies (a terminal-expression array, `console.log([{…}])`, or a
 * Python `print` of a JSON list). Returns `null` for everything else —
 * a fast `[`-prefix guard keeps the common non-array case off the
 * `JSON.parse` path.
 */
function tableFromOutputText(text: string): RichOutputTable | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed[0] !== '[') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return detectAutoTable(parsed);
}

function NotebookCodeCellRowImpl({
  cell,
  cellIndex,
  status,
  durationMs,
  varFlow,
  executionOrder = null,
  isActive,
  editRequestNonce = null,
  canMoveUp,
  canMoveDown,
  disabled,
  onActivate,
  onSourceChange,
  onRunCell,
  onRunAndAdvance,
  onRunAndInsertBelow,
  onMoveUp,
  onMoveDown,
  onDelete,
  onLanguageChange,
}: NotebookCodeCellRowProps) {
  const { t } = useTranslation();
  const shellRef = useRef<HTMLElement | null>(null);
  const label = languageLabel(cell.language);
  // T19 — "Explain this error": on an errored cell, LOCAL_AI users get the
  // consent-gated AI trigger (shared ExplainErrorButton owns the dialog +
  // open state). `canExplainError` gates the wrapper so Free users don't get
  // an empty padded slot.
  const canExplainError = useEntitlement('LOCAL_AI');
  // Signal-Slate — derived mode for the active cell. EDIT when the live
  // Monaco editor is mounted (the caret is in the cell); COMMAND when only
  // the static view shows and focus sits on the shell. The header label +
  // accent bar read off this.
  const [editing, setEditing] = useState(false);
  const mode: 'command' | 'edit' = editing ? 'edit' : 'command';

  // PERF-003 / PERF-004 — keep the source in local React state and
  // debounce the persisted-store write, exactly like
  // `SqlQueryEditor` / `HttpRequestEditor`. Previously every keystroke
  // called `onSourceChange` → `updateCellSource`, which writes the
  // localStorage-persisted `notebookStore` AND re-renders every sibling
  // cell (the `notebook.cells` array reference changes on each char).
  // Now the store only sees a write after `getNotebookCellAutoSaveDebounceMs()`
  // of quiet, so typing in one cell neither persists per-char nor
  // churns its siblings.
  const [source, setSource] = useState<string>(cell.source);
  const lastSavedRef = useRef<string>(cell.source);
  const latestSourceRef = useRef<string>(cell.source);
  const latestOnSourceChangeRef = useRef(onSourceChange);
  // The id of the cell the pending draft was typed into, captured at
  // schedule time. The flush reads THIS id (not the live `cell.id`
  // prop) so a flush that fires after the row rebinds to a different
  // cell still lands on the cell the edit was typed into. The store
  // no-ops writes to unknown / mismatched ids, so a flush after the
  // cell is deleted is harmless.
  const pendingTargetIdRef = useRef<string>(cell.id);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestOnSourceChangeRef.current = onSourceChange;
  }, [onSourceChange]);

  useEffect(() => {
    latestSourceRef.current = source;
  }, [source]);

  // Flush the pending draft to the cell it was typed into. Stable
  // identity (no deps) so the cell-switch + unmount effects can call it
  // without re-arming on every render.
  const flushPendingSource = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const latest = latestSourceRef.current;
    if (latest !== lastSavedRef.current) {
      latestOnSourceChangeRef.current(pendingTargetIdRef.current, latest);
      lastSavedRef.current = latest;
    }
  }, []);

  // Sync the local draft when the row rebinds to a different cell or
  // when an external edit (run output never touches source; reorder /
  // rehydrate can) changes `cell.source` out from under us. Flush the
  // previous cell's pending draft FIRST so it lands on the cell it was
  // typed into before we adopt the new value.
  const lastCellIdRef = useRef<string>(cell.id);
  useEffect(() => {
    if (lastCellIdRef.current !== cell.id) {
      flushPendingSource();
      lastCellIdRef.current = cell.id;
    }
    if (cell.source !== lastSavedRef.current) {
      setSource(cell.source);
      latestSourceRef.current = cell.source;
      lastSavedRef.current = cell.source;
      pendingTargetIdRef.current = cell.id;
    }
  }, [cell.id, cell.source, flushPendingSource]);

  // Flush on unmount (tab close, panel teardown, cell delete) so an
  // edit typed <debounce before the row unmounts still persists.
  useEffect(() => {
    return () => {
      flushPendingSource();
    };
  }, [flushPendingSource]);

  const handleSourceChange = useCallback(
    (next: string) => {
      setSource(next);
      latestSourceRef.current = next;
      // Capture the cell being edited NOW so a later flush targets it.
      pendingTargetIdRef.current = cell.id;
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        flushPendingSource();
      }, getNotebookCellAutoSaveDebounceMs());
    },
    [cell.id, flushPendingSource]
  );

  // Run reads the cell source from the persisted store
  // (`useNotebookRun` → `getNotebookForTab`), so any pending debounced
  // draft MUST be flushed synchronously before a run fires — otherwise
  // a Cmd+Enter <debounce after the last keystroke would run stale
  // source. Mirrors `SqlQueryEditor.handleRun`'s flush-before-run.
  const runWithFlush = useCallback(
    (run: (cellId: string) => void) => {
      flushPendingSource();
      run(cell.id);
    },
    [cell.id, flushPendingSource]
  );
  // FASE 4 token sweep — the language chip reuses the canonical
  // `languageBadgeTone` triple (the same token-backed oklch pairs the
  // file-tree glyph, editor tab strip, and action pill consume) instead
  // of a bespoke raw-palette map, so JS/TS/PY tints can never drift from
  // the rest of the app and carry no hardcoded Tailwind scale.
  const languageTone = languageBadgeTone(cell.language);
  // MOV.03 — the OUTPUT region is collapsible. Default expanded so the
  // surface matches today's always-visible output list; this is purely
  // a view toggle and never touches run/store state.
  const [outputsCollapsed, setOutputsCollapsed] = useState(false);
  const hasOutputs = cell.outputs.length > 0;
  // While the cell is running we keep the bare output list (no header):
  // the top cell-header chip already owns the spinner, and a "Success"
  // badge would be premature. The header reappears once a terminal
  // status (ok / error / stopped) lands.
  const showOutputHeader = hasOutputs && status !== 'running';
  const outputsRegionId = `${cell.id}-outputs`;
  // FASE 4 — derived latency + variable-flow display values. Latency
  // only shows once a run has produced a finite, terminal timing; we
  // hide it while `running` so the badge doesn't flash a stale number.
  const hasLatency =
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    status !== 'running' &&
    status !== 'idle';
  const latencyLabel = hasLatency ? formatLatencyMs(durationMs) : null;
  const usesKeys = varFlow?.uses ?? [];
  const producesKeys = varFlow?.produces ?? [];

  // RL-043 Slice (Monaco cells) — command-mode "enter edit" requests
  // (Jupyter Enter / run-and-advance / insert-below) flow in as a bumped
  // nonce; mount the Monaco editor in response (it focuses itself on mount).
  // Match NotebookMarkdownCellRow: depend ONLY on the nonce.
  //   - Do NOT gate on `disabled` / `status`: `disabled` is the GLOBAL
  //     `isAnyCellRunning`, so gating it makes Shift+Enter advance fail to
  //     open the next cell whenever ANY cell is running (the next cell is
  //     not the one running). Advancing into a cell mid-run must still open
  //     it — Monaco mounts read-only via the `disabled` prop.
  //   - Do NOT put `disabled` / `status` in the deps: a later run-status
  //     change would otherwise re-fire this effect on a stale nonce and
  //     re-open a cell the user had escaped out of.
  // The flip is deferred a frame so React's set-state-in-effect rule stays
  // quiet without changing the visible command-mode flow.
  useEffect(() => {
    if (editRequestNonce === null) return undefined;
    const frame = requestAnimationFrame(() => setEditing(true));
    return () => cancelAnimationFrame(frame);
  }, [editRequestNonce]);

  return (
    <article
      ref={shellRef}
      data-testid="notebook-code-cell-row"
      data-notebook-cell-shell="true"
      data-cell-id={cell.id}
      data-cell-kind="code"
      data-status={status}
      data-cell-mode={isActive ? mode : undefined}
      data-active={isActive ? 'true' : undefined}
      // Command mode lives on the shell: a `tabIndex=-1` element that
      // takes focus when the user Escapes out of the editor or navigates
      // with j/k. The notebook's container `onKeyDown` reads command-mode
      // keys here (editable descendants swallow their own keys).
      tabIndex={-1}
      onMouseDown={() => onActivate(cell.id)}
      onFocus={() => onActivate(cell.id)}
      className={cn(
        'relative grid gap-2 rounded-md border bg-background-elevated/60 p-3 pl-4 transition-colors outline-none',
        isActive
          ? 'border-primary/60 ring-1 ring-primary/25'
          : 'border-border/60',
        // Edit mode tints the accent bar a touch stronger so the two
        // modes read at a glance (Jupyter's green/blue gutter).
        'focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/25'
      )}
    >
      {/* Left accent bar — the at-a-glance active-cell affordance. Edit
          mode uses the primary accent; command mode a quieter tint. */}
      {isActive ? (
        <span
          aria-hidden="true"
          data-testid="notebook-cell-accent"
          className={cn(
            'absolute inset-y-1 left-0 w-[3px] rounded-full',
            mode === 'edit' ? 'bg-primary' : 'bg-primary/40'
          )}
        />
      ) : null}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* RL-043 Slice F — language selector. JS / TS / Python are all
              runnable now (Python runs independently per cell). Styled as
              the canonical language-tone pill. */}
          <select
            className="h-5 cursor-pointer appearance-none rounded px-1.5 text-eyebrow font-bold uppercase tracking-wider outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed"
            style={{
              background: languageTone.background,
              color: languageTone.foreground,
            }}
            data-testid="notebook-code-cell-language"
            aria-label={t('notebook.cell.languageSelectLabel')}
            value={cell.language}
            disabled={disabled}
            onChange={(event) =>
              onLanguageChange(
                cell.id,
                event.target.value as NotebookCellLanguage
              )
            }
          >
            {NOTEBOOK_CELL_LANGUAGES.map((lang) => (
              // Disable any schema language the runner can't execute yet,
              // so the selector stays consistent with handleLanguageChange
              // (view) + setCellLanguage (store). Today all four (JS / TS /
              // Python / SQL) run, so this is a no-op guard that
              // future-proofs the next language added to the schema before
              // it is wired to a runner.
              <option
                key={lang}
                value={lang}
                disabled={!isNotebookRunnableLanguage(lang)}
              >
                {languageBadgeTone(lang).code}
              </option>
            ))}
          </select>
          <span
            className="text-eyebrow uppercase tracking-wider text-muted"
            data-testid="notebook-code-cell-index"
          >
            {t('notebook.cell.indexLabel', { index: cellIndex + 1 })}
          </span>
          {/* Signal-Slate — Jupyter `[N]` execution stamp. Mono, muted,
              and only present once the cell has run. */}
          {executionOrder !== null ? (
            <span
              className="font-mono text-eyebrow text-fg-subtle"
              data-testid="notebook-code-cell-execution-order"
            >
              {t('notebook.cell.executionOrder', { n: executionOrder })}
            </span>
          ) : null}
          {/* FASE 4 — canonical StatusBadge (was a bespoke pill). The
              latency rides inside the badge as a mono suffix, mirroring
              the proto's `StatusBadge … · 1.2 ms`. */}
          <span data-testid="notebook-code-cell-status" data-status={status}>
            <StatusBadge tone={STATUS_BADGE_TONE[status]} dot>
              {t(`notebook.status.${statusKey(status)}`)}
              {latencyLabel
                ? t('notebook.cell.latencySuffix', { ms: latencyLabel })
                : ''}
            </StatusBadge>
          </span>
          {/* FASE 4 — inter-cell variable flow. `uses` is an
              accent-soft chip (the DS `info` ramp is the canonical
              accent-tinted soft surface); `produces` is a muted mono
              `→` list. Both are token-only and render only when
              populated. */}
          {usesKeys.length > 0 ? (
            <span
              data-testid="notebook-code-cell-uses"
              className="inline-flex h-5 items-center rounded border border-info-border/40 bg-info-bg px-2 font-mono text-micro text-info-fg"
            >
              {t('notebook.cell.usesChip', { names: usesKeys.join(', ') })}
            </span>
          ) : null}
          {producesKeys.length > 0 ? (
            <span
              data-testid="notebook-code-cell-produces"
              className="inline-flex h-5 items-center font-mono text-micro text-fg-subtle"
            >
              {t('notebook.cell.producesChip', {
                names: producesKeys.join(', '),
              })}
            </span>
          ) : null}
          {/* RL-043 Slice F / T17 — Python cells share a per-notebook
              kernel scope, so cell 2 sees cell 1's imports/vars (Restart
              kernel clears it). The chip truncates; the full sentence is
              the hover title. */}
          {cell.language === 'python' ? (
            <span
              data-testid="notebook-code-cell-python-hint"
              className="max-w-[14rem] truncate text-micro text-fg-subtle"
              title={t('notebook.cell.pythonIndependentHint')}
            >
              {t('notebook.cell.pythonIndependentHint')}
            </span>
          ) : null}
          {/* T16 — SQL cells run on the shared DuckDB engine, so tables
              created in one cell persist to later SQL cells (and the SQL
              workspace). The chip truncates; the hover title carries the
              full sentence. */}
          {cell.language === 'sql' ? (
            <span
              data-testid="notebook-code-cell-sql-hint"
              className="max-w-[14rem] truncate text-micro text-fg-subtle"
              title={t('notebook.cell.sqlSharedHint')}
            >
              {t('notebook.cell.sqlSharedHint')}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isActive ? (
            <span
              data-testid="notebook-cell-mode"
              data-mode={mode}
              className={cn(
                'mr-1 hidden rounded px-1.5 text-micro font-semibold uppercase tracking-wider sm:inline',
                mode === 'edit'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-bg-panel-alt text-fg-subtle'
              )}
            >
              {t(
                mode === 'edit'
                  ? 'notebook.command.modeEdit'
                  : 'notebook.command.modeCommand'
              )}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => runWithFlush(onRunCell)}
            disabled={disabled || status === 'running'}
            data-testid="notebook-code-cell-run"
            className="focus-ring inline-flex h-6 items-center gap-1 rounded border border-success-border bg-success-bg px-2 text-eyebrow font-medium text-success-fg hover:border-success-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={9} aria-hidden="true" />
            {t('notebook.cell.runCell')}
          </button>
          <button
            type="button"
            onClick={() => onMoveUp(cell.id)}
            disabled={!canMoveUp || disabled}
            aria-label={t('notebook.cell.moveUp')}
            data-testid="notebook-code-cell-move-up"
            className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowUp size={11} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMoveDown(cell.id)}
            disabled={!canMoveDown || disabled}
            aria-label={t('notebook.cell.moveDown')}
            data-testid="notebook-code-cell-move-down"
            className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowDown size={11} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(cell.id)}
            disabled={disabled}
            aria-label={t('notebook.cell.delete')}
            data-testid="notebook-code-cell-delete"
            className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-error-bg hover:text-error-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={11} aria-hidden="true" />
          </button>
        </div>
      </header>
      {/* RL-043 Slice (Monaco cells) — the body is a Monaco editor while
          editing and a cheap colorized static view otherwise, so a large
          notebook never mounts more than ~1 editor. The run / Esc keybinds
          and the draft-flush-before-run contract are preserved through the
          callbacks below. A plain Enter inside Monaco inserts a newline. */}
      <NotebookCellEditor
        cellId={cell.id}
        language={cell.language}
        value={source}
        editing={editing}
        disabled={disabled || status === 'running'}
        ariaLabel={t('notebook.cell.codeEditorLabel')}
        placeholder={t('notebook.cell.codeSourcePlaceholder', {
          language: label,
        })}
        onChange={handleSourceChange}
        onRequestEdit={() => {
          if (disabled || status === 'running') return;
          onActivate(cell.id);
          setEditing(true);
        }}
        onBlur={() => {
          setEditing(false);
          flushPendingSource();
        }}
        onRunInPlace={() => {
          if (disabled || status === 'running') return;
          runWithFlush(onRunCell);
        }}
        onRunAdvance={() => {
          if (disabled || status === 'running') return;
          runWithFlush(onRunAndAdvance ?? onRunCell);
        }}
        onRunInsertBelow={() => {
          if (disabled || status === 'running') return;
          runWithFlush(onRunAndInsertBelow ?? onRunCell);
        }}
        onEscape={() => {
          flushPendingSource();
          setEditing(false);
          shellRef.current?.focus();
        }}
      />
      {hasOutputs ? (
        <div className="overflow-hidden rounded border border-border/40 bg-background-elevated/50">
          {showOutputHeader ? (
            <ResultHeader
              status={
                <StatusBadge tone={STATUS_BADGE_TONE[status]} dot>
                  {t(`notebook.status.${outputStatusKey(status)}`)}
                </StatusBadge>
              }
              meta={
                latencyLabel
                  ? t('notebook.cell.outputMetaWithLatency', {
                      count: cell.outputs.length,
                      ms: latencyLabel,
                    })
                  : t('notebook.cell.outputMeta', {
                      count: cell.outputs.length,
                    })
              }
              trailing={
                <button
                  type="button"
                  onClick={() => setOutputsCollapsed((prev) => !prev)}
                  aria-expanded={!outputsCollapsed}
                  aria-controls={outputsRegionId}
                  aria-label={
                    outputsCollapsed
                      ? t('notebook.cell.expandOutput')
                      : t('notebook.cell.collapseOutput')
                  }
                  data-testid="notebook-code-cell-output-toggle"
                  className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-panel-alt hover:text-fg-base"
                >
                  {outputsCollapsed ? (
                    <ChevronRight size={12} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={12} aria-hidden="true" />
                  )}
                </button>
              }
            />
          ) : null}
          {showOutputHeader && outputsCollapsed ? null : (
            <ul
              role="list"
              id={outputsRegionId}
              data-testid="notebook-code-cell-outputs"
              className="grid gap-0.5 p-2"
            >
              {cell.outputs.map((output, idx) => {
                // T3 — a stdout output that is a homogeneous JSON array of
                // objects renders as a table (mirroring the console's
                // auto-table), instead of raw JSON text. stderr always
                // stays plain error-toned text.
                const table =
                  output.stream === 'stdout'
                    ? tableFromOutputText(output.text)
                    : null;
                if (table) {
                  return (
                    <li
                      key={`${cell.id}-output-${idx}`}
                      data-stream={output.stream}
                      data-rich="table"
                    >
                      <RichTableGrid payload={table} />
                    </li>
                  );
                }
                return (
                  <li
                    key={`${cell.id}-output-${idx}`}
                    data-stream={output.stream}
                    className={cn(
                      'whitespace-pre-wrap break-all font-mono text-caption',
                      output.stream === 'stderr'
                        ? 'text-error-fg'
                        : 'text-foreground'
                    )}
                  >
                    {output.text}
                  </li>
                );
              })}
            </ul>
          )}
          {status === 'error' && canExplainError ? (
            <div className="px-2 pb-2">
              <ExplainErrorButton
                errorMessage={cell.outputs
                  .filter((output) => output.stream === 'stderr')
                  .map((output) => output.text)
                  .join('\n')}
                code={cell.source}
                language={cell.language}
                testId="notebook-cell-explain-error"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * RL-043 Slice H fold C — memoized so the windowed cell list only re-renders
 * the rows whose props actually change. Every handler the view passes is a
 * stable `useCallback`, and the per-cell data props (cell, status, latency,
 * var-flow, execution order, active/move flags) are referentially stable
 * across an unrelated sibling's edit, so the default shallow-prop comparison
 * is sufficient — a keystroke in one cell no longer re-renders every other
 * mounted row.
 */
export const NotebookCodeCellRow = memo(NotebookCodeCellRowImpl);
