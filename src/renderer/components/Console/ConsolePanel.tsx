import { Clock, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConsoleEntry, ConsoleEntryType } from '../../types';
import { useConsoleStore } from '../../stores/consoleStore';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import { useRunner } from '../../hooks/useRunner';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { replayHistoryEntry } from '../../utils/replayHistoryEntry';
import { trackEvent } from '../../utils/telemetry';
import { IconButton, Tooltip } from '../ui/chrome';
import { ExecutionComparisonModal } from './ExecutionComparisonModal';
import { ExecutionHistoryPopover } from './ExecutionHistoryPopover';

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
}: {
  entry: ConsoleEntry;
  showTimestamps: boolean;
  typeLabel: Record<ConsoleEntryType, string>;
}) {
  const labelClass = TYPE_BADGE[entry.type];
  const contentClass = TYPE_COLOR[entry.type];

  return (
    <div className="group flex gap-3 rounded-2xl px-2 py-1.5 hover:bg-surface-strong/52">
      {showTimestamps && (
        <span className="shrink-0 select-none tabular-nums text-muted">{formatTime(entry.timestamp)}</span>
      )}
      <span className={`shrink-0 select-none font-bold text-[10px] leading-5 ${labelClass}`}>
        {typeLabel[entry.type]}
      </span>
      {entry.line !== undefined && (
        <span className="shrink-0 select-none text-muted">L{entry.line}</span>
      )}
      <AnsiContent text={entry.content} className={contentClass} />
      {entry.executionTime !== undefined && (
        <span className="ml-auto shrink-0 select-none tabular-nums text-muted">
          {formatExecTime(entry.executionTime)}
        </span>
      )}
    </div>
  );
}

export function ConsolePanel() {
  const { t } = useTranslation();
  const { run, isRunning } = useRunner();
  const effectiveTier = useEffectiveTier();
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const { entries, activeFilters, showTimestamps, clear, toggleFilter, toggleTimestamps } =
    useConsoleStore();
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

  const visibleEntries = entries.filter((entry) => activeFilters.has(entry.type));

  return (
    <div id="guided-tour-console" className="flex h-full flex-col bg-background/65">
      <div className="surface-header flex min-h-12 items-center justify-between gap-3 px-4">
        <div>
          <span className="panel-title">{t('console.title')}</span>
          <p className="mt-0.5 text-[11px] text-muted">{t('console.description')}</p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {FILTER_TYPES.map((type) => {
            const active = activeFilters.has(type);
            const count = entries.filter((entry) => entry.type === type).length;

            return (
              <Tooltip
                key={type}
                content={t('console.filters.toggle', {
                  type: t(`console.filters.type.${type}`).toLowerCase(),
                })}
              >
                <button
                  onClick={() => toggleFilter(type)}
                  className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${
                    active
                      ? `border-border-strong/90 bg-surface-strong/90 ${TYPE_BADGE[type]}`
                      : 'border-transparent text-muted hover:border-border/70 hover:bg-surface-strong/72'
                  }`}
                >
                  {typeLabel[type]}
                  {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
                </button>
              </Tooltip>
            );
          })}
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
              {entries.length === 0
                ? t('console.empty.output')
                : t('console.empty.filtered')}
            </p>
            {entries.length === 0 ? (
              <p className="mt-1 max-w-md font-sans text-[11.5px] leading-[1.45] text-muted">
                {t('console.empty.hint')}
              </p>
            ) : null}
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              showTimestamps={showTimestamps}
              typeLabel={typeLabel}
            />
          ))
        )}
      </div>

      <ExecutionComparisonModal entries={comparison} onClose={handleCloseComparison} />
    </div>
  );
}
