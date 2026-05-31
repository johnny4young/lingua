/**
 * RL-043 Slice A — Single code-cell row.
 *
 * Layout:
 *   - Header: language badge + cell index + status pill + action row
 *     (Run cell / Move up / Move down / Delete cell).
 *   - Body: source `<textarea>` (auto-grow to content height).
 *   - Outputs: stdout (foreground) + stderr (error tone) inline below
 *     the source.
 *
 * Slice A intentionally uses a textarea instead of Monaco. Slice B+
 * promotes to a virtualized Monaco editor — the surface contract
 * (source string, language, run handler) stays unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Play,
  Trash2,
} from 'lucide-react';
import type { NotebookCodeCellV1 } from '../../../shared/notebook';
import type { NotebookCellRunStatus } from '../../stores/notebookStore';
import { cn } from '../../utils/cn';
import { languageBadgeTone, languageLabel } from '../../utils/languageMeta';
import { ResultHeader } from '../ui/ResultHeader';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';
import { getNotebookCellAutoSaveDebounceMs } from './notebookCellEditorTiming';

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

export function NotebookCodeCellRow({
  cell,
  cellIndex,
  status,
  durationMs,
  varFlow,
  executionOrder = null,
  isActive,
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
}: NotebookCodeCellRowProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const label = languageLabel(cell.language);
  // Signal-Slate — derived mode for the active cell. EDIT when the caret
  // is in the textarea; COMMAND when focus sits on the shell. We track it
  // off textarea focus so the header label + accent bar reflect reality.
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

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
  }, [source]);

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
      // takes focus when the user Escapes out of the textarea or
      // navigates with j/k. The notebook's container `onKeyDown` reads
      // command-mode keys here (textareas swallow their own keys).
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
          <span
            className="inline-flex h-5 items-center rounded px-1.5 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: languageTone.background,
              color: languageTone.foreground,
            }}
            data-testid="notebook-code-cell-language"
          >
            {languageTone.code}
          </span>
          <span
            className="text-[10px] uppercase tracking-wider text-muted"
            data-testid="notebook-code-cell-index"
          >
            {t('notebook.cell.indexLabel', { index: cellIndex + 1 })}
          </span>
          {/* Signal-Slate — Jupyter `[N]` execution stamp. Mono, muted,
              and only present once the cell has run. */}
          {executionOrder !== null ? (
            <span
              className="font-mono text-[10px] text-fg-subtle"
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
              className="inline-flex h-5 items-center rounded border border-info-border/40 bg-info-bg px-2 font-mono text-[9.5px] text-info-fg"
            >
              {t('notebook.cell.usesChip', { names: usesKeys.join(', ') })}
            </span>
          ) : null}
          {producesKeys.length > 0 ? (
            <span
              data-testid="notebook-code-cell-produces"
              className="inline-flex h-5 items-center font-mono text-[9.5px] text-fg-subtle"
            >
              {t('notebook.cell.producesChip', {
                names: producesKeys.join(', '),
              })}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isActive ? (
            <span
              data-testid="notebook-cell-mode"
              data-mode={mode}
              className={cn(
                'mr-1 hidden rounded px-1.5 text-[9px] font-semibold uppercase tracking-wider sm:inline',
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
            className="inline-flex h-6 items-center gap-1 rounded border border-success-border bg-success-bg px-2 text-[10px] font-medium text-success-fg hover:border-success-fg disabled:cursor-not-allowed disabled:opacity-50"
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
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowUp size={11} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMoveDown(cell.id)}
            disabled={!canMoveDown || disabled}
            aria-label={t('notebook.cell.moveDown')}
            data-testid="notebook-code-cell-move-down"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowDown size={11} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(cell.id)}
            disabled={disabled}
            aria-label={t('notebook.cell.delete')}
            data-testid="notebook-code-cell-delete"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-error-bg hover:text-error-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={11} aria-hidden="true" />
          </button>
        </div>
      </header>
      <textarea
        ref={textareaRef}
        value={source}
        onChange={(event) => handleSourceChange(event.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          flushPendingSource();
        }}
        onKeyDown={(event) => {
          // Esc drops out of EDIT mode into COMMAND mode: flush the
          // draft, then move focus to the shell so the container's
          // command-mode keybinds take over. This is the Jupyter
          // muscle-memory toggle (Esc = command, Enter = edit).
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            flushPendingSource();
            setEditing(false);
            shellRef.current?.focus();
            return;
          }
          if (event.key !== 'Enter') return;
          // Jupyter-parity run keybinds (the muscle memory every
          // notebook user expects):
          //   Cmd/Ctrl+Enter — run in place, keep focus here.
          //   Shift+Enter    — run, then advance to the next cell
          //                    (create one if this is the last).
          //   Alt+Enter      — run, then insert a fresh cell below.
          // A plain Enter falls through to the textarea (newline).
          const runInPlace = event.metaKey || event.ctrlKey;
          const advance = event.shiftKey;
          const insertBelow = event.altKey;
          if (!runInPlace && !advance && !insertBelow) return;
          event.preventDefault();
          event.stopPropagation();
          if (disabled || status === 'running') return;
          // PERF-003 — flush the pending debounced draft before the run
          // so `useNotebookRun` (which reads source from the persisted
          // store) sees the latest text typed <debounce ago.
          if (advance) {
            runWithFlush(onRunAndAdvance ?? onRunCell);
          } else if (insertBelow) {
            runWithFlush(onRunAndInsertBelow ?? onRunCell);
          } else {
            runWithFlush(onRunCell);
          }
        }}
        disabled={disabled || status === 'running'}
        data-testid="notebook-code-cell-source"
        spellCheck={false}
        placeholder={t('notebook.cell.codeSourcePlaceholder', {
          language: label,
        })}
        title={t('notebook.cell.codeSourceShortcutHint')}
        rows={3}
        className="min-h-[64px] resize-none rounded border border-border/60 bg-background p-2 font-mono text-xs text-foreground outline-none focus:border-border-strong disabled:cursor-not-allowed"
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
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-panel-alt hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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
              {cell.outputs.map((output, idx) => (
                <li
                  key={`${cell.id}-output-${idx}`}
                  data-stream={output.stream}
                  className={cn(
                    'whitespace-pre-wrap break-all font-mono text-[11px]',
                    output.stream === 'stderr'
                      ? 'text-error-fg'
                      : 'text-foreground'
                  )}
                >
                  {output.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </article>
  );
}
