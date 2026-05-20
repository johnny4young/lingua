import { Clock, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConsoleEntry, ConsoleEntryType, ConsolePayloadKindFilter } from '../../types';
import { useConsoleStore } from '../../stores/consoleStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import { useRunner } from '../../hooks/useRunner';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { replayHistoryEntry } from '../../utils/replayHistoryEntry';
import { trackEvent } from '../../utils/telemetry';
import { IconButton, Kbd, Tooltip } from '../ui/chrome';
import { EyebrowMono, MonoBadge } from '../ui/primitives';
import { ExecutionComparisonModal } from './ExecutionComparisonModal';
import { ExecutionHistoryPopover } from './ExecutionHistoryPopover';
import { ConsoleEntryRenderer } from './ConsoleEntryRenderer';
import { richKindBucket } from './richConsoleFormat';

interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/**
 * ANSI foreground codes routed through the DS canonical console
 * tokens (declared in src/renderer/index.css under :root,.light and
 * .dark / [data-theme="dark"]). The DS spec defines six console
 * roles with theme-aware values:
 *
 *   --color-console-stdout    → ANSI 37/97 (default white text)
 *   --color-console-stderr    → ANSI 31/91 (red)
 *   --color-console-warning   → ANSI 33/93 (yellow / amber)
 *   --color-console-info      → ANSI 34/94/36/96 (blue / cyan)
 *   --color-console-prompt    → ANSI 35/95 (magenta in legacy, mapped
 *                                to the slate accent here so prompts
 *                                read as the brand color rather than
 *                                a third color outside the system)
 *   --color-console-timestamp → ANSI 30/90 (the dim greys reserved
 *                                for metadata in tools like git/npm
 *                                output)
 *
 * The bright variants (90-97) deliberately collapse to the same
 * semantic var as their non-bright sibling — the original ANSI
 * "brightness boost" was arbitrary hex and preserving it would re-
 * introduce the hardcoded-hex drift the migration fixes. If a
 * future slice wants the distinction, declare
 * --color-console-stderr-strong (etc) and split the rows.
 */
const ANSI_FG: Record<number, string> = {
  30: 'var(--color-console-timestamp)',
  31: 'var(--color-console-stderr)',
  32: 'var(--color-success-fg)',
  33: 'var(--color-console-warning)',
  34: 'var(--color-console-info)',
  35: 'var(--color-console-prompt)',
  36: 'var(--color-console-info)',
  37: 'var(--color-console-stdout)',
  90: 'var(--color-console-timestamp)',
  91: 'var(--color-console-stderr)',
  92: 'var(--color-success-fg)',
  93: 'var(--color-console-warning)',
  94: 'var(--color-console-info)',
  95: 'var(--color-console-prompt)',
  96: 'var(--color-console-info)',
  97: 'var(--color-console-stdout)',
};

function parseAnsi(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let color: string | undefined;
  let bold = false;
  let dim = false;

  const push = (text: string) => {
    if (text) spans.push({ text, color, bold, dim });
  };

  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    push(raw.slice(last, match.index));
    last = match.index + match[0].length;

    const controlSequence = match[1] ?? '';
    const codes = controlSequence === '' ? [0] : controlSequence.split(';').map(Number);
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
        dim = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (ANSI_FG[code]) {
        color = ANSI_FG[code];
      }
    }
  }

  push(raw.slice(last));
  return spans;
}

function hasAnsi(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[/.test(value);
}

const TYPE_COLOR: Record<ConsoleEntryType, string> = {
  log: 'text-foreground',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-error',
  result: 'text-primary',
};

const TYPE_BADGE: Record<ConsoleEntryType, string> = {
  log: 'text-muted',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-error',
  result: 'text-primary',
};

const FILTER_TYPES: ConsoleEntryType[] = ['log', 'info', 'warn', 'error'];

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatExecTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// `nextReplayTabId` and `replayTabName` moved to
// `src/renderer/utils/replayHistoryEntry.ts` so the command-palette
// per-entry Replay surface can share the same helper as this popover.

function AnsiContent({ text, className }: { text: string; className: string }) {
  if (!hasAnsi(text)) {
    return <span className={`whitespace-pre-wrap ${className}`}>{text}</span>;
  }

  const spans = parseAnsi(text);
  return (
    <span className={`whitespace-pre-wrap ${className}`}>
      {spans.map((span, index) => (
        <span
          key={index}
          style={span.color ? { color: span.color } : undefined}
          className={span.bold ? 'font-bold' : span.dim ? 'opacity-50' : undefined}
        >
          {span.text}
        </span>
      ))}
    </span>
  );
}

function EntryRow({
  entry,
  showTimestamps,
  typeLabel,
  repeatCount,
  richRenderingEnabled,
}: {
  entry: ConsoleEntry;
  showTimestamps: boolean;
  typeLabel: Record<ConsoleEntryType, string>;
  /** RL-044 Slice 1B fold H — number of collapsed duplicate entries. ≥2 surfaces the ×N badge. */
  repeatCount: number;
  /** RL-044 Slice 1B fold E — when false, paint the legacy text path even when payload is set. */
  richRenderingEnabled: boolean;
}) {
  const labelClass = TYPE_BADGE[entry.type];
  const contentClass = TYPE_COLOR[entry.type];
  // Capture the payload in a const so the rich-render branch reads
  // through narrowed types without resorting to a non-null assertion.
  const payload = Array.isArray(entry.payload) ? entry.payload : null;
  const usesRichRender = richRenderingEnabled && payload !== null && payload.length > 0;

  return (
    <div
      className="group flex gap-3 rounded-2xl px-2 py-1.5 hover:bg-surface-strong/52"
      data-testid="console-entry-row"
    >
      {showTimestamps && (
        <span className="shrink-0 select-none tabular-nums text-muted">
          {formatTime(entry.timestamp)}
        </span>
      )}
      <span className={`shrink-0 select-none font-bold text-[10px] leading-5 ${labelClass}`}>
        {typeLabel[entry.type]}
      </span>
      {entry.line !== undefined && (
        <span className="shrink-0 select-none text-muted">L{entry.line}</span>
      )}
      {usesRichRender && payload !== null ? (
        <div className={contentClass}>
          <ConsoleEntryRenderer
            payloads={payload}
            fallbackText={entry.content}
            language={entry.language}
          />
        </div>
      ) : (
        <AnsiContent text={entry.content} className={contentClass} />
      )}
      {repeatCount > 1 && (
        <span
          className="shrink-0 select-none rounded-full border border-border/60 px-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle"
          data-testid="console-repeat-count"
          title={`×${repeatCount}`}
        >
          ×{repeatCount}
        </span>
      )}
      {entry.executionTime !== undefined && (
        <span className="ml-auto shrink-0 select-none tabular-nums text-muted">
          {formatExecTime(entry.executionTime)}
        </span>
      )}
    </div>
  );
}

/**
 * RL-044 Slice 1B fold A — closed-enum list of payload-kind filter
 * chips. Mirrors the order of the rendered RichValue dispatch so the
 * chip row reads the same left-to-right as a typical row of payloads.
 */
const PAYLOAD_KIND_CHIPS: ConsolePayloadKindFilter[] = [
  'table',
  'object',
  'array',
  'mapSet',
  'text',
  'errorish',
];

/**
 * RL-044 Slice 1B fold H — collapse consecutive identical entries.
 * Two entries are equal when their `type` + `line` + `content` +
 * JSON-shape of `payload` match. The collapse is purely visual: the
 * underlying entries stay in the store, so `Recent runs` and other
 * surfaces still see the full list.
 */
interface CollapsedRow {
  entry: ConsoleEntry;
  repeatCount: number;
}

function collapseIdenticalEntries(entries: ConsoleEntry[]): CollapsedRow[] {
  const result: CollapsedRow[] = [];
  for (const entry of entries) {
    const last = result.length > 0 ? result[result.length - 1] : undefined;
    if (last && entriesAreEqual(last.entry, entry)) {
      last.repeatCount += 1;
    } else {
      result.push({ entry, repeatCount: 1 });
    }
  }
  return result;
}

function entriesAreEqual(a: ConsoleEntry, b: ConsoleEntry): boolean {
  if (a.type !== b.type) return false;
  if (a.line !== b.line) return false;
  if (a.content !== b.content) return false;
  // Cheap length check before paying for JSON.stringify — short-
  // circuits the common case where two entries share `content` but
  // their payload arrays differ in size (e.g. `console.log("x")` vs.
  // `console.log("x", extra)`).
  const aLen = a.payload?.length ?? 0;
  const bLen = b.payload?.length ?? 0;
  if (aLen !== bLen) return false;
  if (aLen === 0) return true;
  const aPayload = JSON.stringify(a.payload);
  const bPayload = JSON.stringify(b.payload);
  return aPayload === bPayload;
}

/** True when the row belongs to a payload-kind bucket currently hidden. */
function entryFilteredByPayloadKind(
  entry: ConsoleEntry,
  hidden: ReadonlySet<ConsolePayloadKindFilter> | undefined
): boolean {
  if (!hidden || hidden.size === 0) return false;
  // Errorish entries (warn / error) are filtered when the special
  // `'errorish'` bucket is hidden, regardless of payload kind.
  if (hidden.has('errorish') && (entry.type === 'warn' || entry.type === 'error')) {
    return true;
  }
  if (!entry.payload || entry.payload.length === 0) {
    // No payload — show unless the user hid `'text'` (the catch-all
    // bucket the renderer dispatches for primitive / function / error
    // payloads + the no-payload fallback).
    return hidden.has('text');
  }
  return entry.payload.some(p => {
    const bucket = richKindBucket(p);
    // The Errors chip historically meant warn/error rows. Slice 1C
    // added payload-level `kind: 'error'` for Python BaseException
    // values, so the same chip must hide those log rows too.
    return hidden.has(bucket) || (bucket === 'error' && hidden.has('errorish'));
  });
}

export function ConsolePanel() {
  const { t } = useTranslation();
  const { run, isRunning } = useRunner();
  const effectiveTier = useEffectiveTier();
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const {
    entries,
    activeFilters,
    hiddenPayloadKinds,
    showTimestamps,
    clear,
    toggleFilter,
    togglePayloadKindFilter,
    toggleTimestamps,
  } = useConsoleStore();
  // RL-044 Slice 1B fold E — master toggle for the rich console
  // dispatch. Off → every row paints through `<AnsiContent>` even if
  // the runner sent a payload.
  const consoleRichRenderingEnabled = useSettingsStore(s => s.consoleRichRenderingEnabled);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const typeLabel: Record<ConsoleEntryType, string> = {
    log: t('console.filters.type.log'),
    info: t('console.filters.type.info'),
    warn: t('console.filters.type.warn'),
    error: t('console.filters.type.error'),
    result: t('console.filters.type.result'),
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || userScrolled.current) return;
    element.scrollTop = element.scrollHeight;
  }, [entries]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    userScrolled.current = !atBottom;
  };

  const handleReplayHistoryEntry = useCallback(
    (entry: ExecutionHistoryEntry) => {
      // Gate telemetry on the actual dispatch — see App.tsx replay
      // handler for rationale (already-running short-circuit, etc.).
      const dispatched = replayHistoryEntry(entry, { isRunning, run });
      if (dispatched) {
        void trackEvent('runtime.history_replay', {
          language: entry.language,
          status: entry.status,
          surface: 'popover',
        });
      }
    },
    [isRunning, run]
  );

  const [comparison, setComparison] = useState<
    [ExecutionHistoryEntry, ExecutionHistoryEntry] | null
  >(null);

  const handleCompareEntries = useCallback(
    (older: ExecutionHistoryEntry, newer: ExecutionHistoryEntry) => {
      setComparison([older, newer]);
    },
    []
  );

  const handleCloseComparison = useCallback(() => {
    setComparison(null);
  }, []);

  const handleBlockedExecutionHistory = useCallback(() => {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: t('upsell.feature.executionHistory'),
    });
    void trackEvent('feature.blocked', {
      entitlement: 'execution-history',
      tier: effectiveTier,
    });
  }, [effectiveTier, t]);

  // RL-044 Slice 1B — apply both the legacy type filter AND the new
  // payload-kind chip filter (fold A), then collapse consecutive
  // identical entries (fold H). Memoised so a flooded console only
  // re-pays the cost when something actually changed.
  const visibleEntries = useMemo(() => {
    const typed = entries.filter(entry => activeFilters.has(entry.type));
    const filtered = typed.filter(entry => !entryFilteredByPayloadKind(entry, hiddenPayloadKinds));
    return collapseIdenticalEntries(filtered);
  }, [entries, activeFilters, hiddenPayloadKinds]);

  const totalCount = entries.length;
  return (
    <div id="guided-tour-console" className="flex h-full flex-col bg-bg-base/65">
      {/* RL-093 Slice 3 — prominent header: eyebrow + count badge +
          inline level chips (LOG · INF · WRN · ERR · RESULT) + the
          ⌘\ keyboard hint so the toggle shortcut is discoverable. */}
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-subtle/60 px-4">
        <div className="flex items-center gap-2.5">
          <EyebrowMono>{t('console.title')}</EyebrowMono>
          {totalCount > 0 ? <MonoBadge tone="accent">{totalCount}</MonoBadge> : null}
          <p className="text-[11px] text-fg-muted">{t('console.description')}</p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {FILTER_TYPES.map(type => {
            const active = activeFilters.has(type);
            const count = entries.filter(entry => entry.type === type).length;

            return (
              <Tooltip
                key={type}
                content={t('console.filters.toggle', {
                  type: t(`console.filters.type.${type}`).toLowerCase(),
                })}
              >
                <button
                  onClick={() => toggleFilter(type)}
                  data-active={active ? 'true' : 'false'}
                  className={`console-filter-chip rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${
                    active
                      ? `border-border-strong/90 bg-bg-panel-alt ${TYPE_BADGE[type]}`
                      : 'border-border/40 text-fg-subtle hover:border-border/80 hover:bg-bg-panel-alt/70'
                  }`}
                >
                  {typeLabel[type]}
                  {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
                </button>
              </Tooltip>
            );
          })}
          <span className="mx-1 hidden h-5 w-px bg-border/60 sm:block" aria-hidden />
          {/* RL-044 Slice 1B fold A — payload-kind chip row. Default
              empty (every kind visible); clicking a chip hides that
              kind. `text` is the catch-all bucket the renderer
              dispatches for primitive / function / error payloads +
              the no-payload fallback. */}
          {PAYLOAD_KIND_CHIPS.map(kind => {
            const hidden = hiddenPayloadKinds.has(kind);
            return (
              <Tooltip key={kind} content={t(`console.rich.filterChip.${kind}`)}>
                <button
                  type="button"
                  onClick={() => togglePayloadKindFilter(kind)}
                  data-active={hidden ? 'false' : 'true'}
                  data-testid={`console-payload-chip-${kind}`}
                  className={`console-filter-chip rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${
                    hidden
                      ? 'border-border/40 text-fg-subtle hover:border-border/80 hover:bg-bg-panel-alt/70'
                      : 'border-border-strong/90 bg-bg-panel-alt text-foreground'
                  }`}
                >
                  {t(`console.rich.filterChip.${kind}`)}
                </button>
              </Tooltip>
            );
          })}
          <span className="mx-1 hidden h-5 w-px bg-border/60 sm:block" aria-hidden />
          <Tooltip content={t('shortcuts.item.toggleConsole.label')}>
            <span className="inline-flex items-center gap-1 text-[10.5px] text-fg-subtle">
              <Kbd>⌘\</Kbd>
            </span>
          </Tooltip>
          <IconButton
            onClick={toggleTimestamps}
            active={showTimestamps}
            tooltip={
              showTimestamps
                ? t('console.actions.hideTimestamps')
                : t('console.actions.showTimestamps')
            }
          >
            <Clock size={13} />
          </IconButton>
          <ExecutionHistoryPopover
            enabled={canUseExecutionHistory}
            onBlocked={handleBlockedExecutionHistory}
            onRerun={handleReplayHistoryEntry}
            onCompare={canUseExecutionHistory ? handleCompareEntries : undefined}
          />
          <IconButton onClick={clear} tooltip={t('console.actions.clear')} tone="danger">
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-6"
      >
        {visibleEntries.length === 0 ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center px-6 py-8 text-center">
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">
              {t('console.title')}
            </p>
            <p className="font-sans text-[13px] font-medium text-foreground">
              {entries.length === 0 ? t('console.empty.output') : t('console.empty.filtered')}
            </p>
            {entries.length === 0 ? (
              <p className="mt-1 max-w-md font-sans text-[11.5px] leading-[1.45] text-muted">
                {t('console.empty.hint')}
              </p>
            ) : null}
          </div>
        ) : (
          visibleEntries.map(({ entry, repeatCount }) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              showTimestamps={showTimestamps}
              typeLabel={typeLabel}
              repeatCount={repeatCount}
              richRenderingEnabled={consoleRichRenderingEnabled}
            />
          ))
        )}
      </div>

      <ExecutionComparisonModal entries={comparison} onClose={handleCloseComparison} />
    </div>
  );
}
