import { Clock, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ConsoleEntry, ConsoleEntryType } from '../../types';
import { useConsoleStore } from '../../stores/consoleStore';
import { IconButton } from '../ui/chrome';

interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

const ANSI_FG: Record<number, string> = {
  30: '#4e4e4e',
  31: '#ff5555',
  32: '#55ff55',
  33: '#ffff55',
  34: '#5555ff',
  35: '#ff55ff',
  36: '#55ffff',
  37: '#cccccc',
  90: '#888888',
  91: '#ff8888',
  92: '#88ff88',
  93: '#ffff88',
  94: '#8888ff',
  95: '#ff88ff',
  96: '#88ffff',
  97: '#ffffff',
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

const TYPE_LABEL: Record<ConsoleEntryType, string> = {
  log: 'LOG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  result: 'RES',
};

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
}: {
  entry: ConsoleEntry;
  showTimestamps: boolean;
}) {
  const labelClass = TYPE_BADGE[entry.type];
  const contentClass = TYPE_COLOR[entry.type];

  return (
    <div className="group flex gap-3 rounded-2xl px-2 py-1.5 hover:bg-surface-strong/52">
      {showTimestamps && (
        <span className="shrink-0 select-none tabular-nums text-muted">{formatTime(entry.timestamp)}</span>
      )}
      <span className={`shrink-0 select-none font-bold text-[10px] leading-5 ${labelClass}`}>
        {TYPE_LABEL[entry.type]}
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
  const { entries, activeFilters, showTimestamps, clear, toggleFilter, toggleTimestamps } =
    useConsoleStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

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

  const visibleEntries = entries.filter((entry) => activeFilters.has(entry.type));

  return (
    <div className="flex h-full flex-col bg-background/65">
      <div className="surface-header flex min-h-12 items-center justify-between gap-3 px-4">
        <div>
          <span className="panel-title">Console</span>
          <p className="mt-0.5 text-[11px] text-muted">Runtime logs, warnings, and output</p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {FILTER_TYPES.map((type) => {
            const active = activeFilters.has(type);
            const count = entries.filter((entry) => entry.type === type).length;

            return (
              <button
                key={type}
                onClick={() => toggleFilter(type)}
                title={`Toggle ${type} output`}
                className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${
                  active
                    ? `border-border-strong/90 bg-surface-strong/90 ${TYPE_BADGE[type]}`
                    : 'border-transparent text-muted hover:border-border/70 hover:bg-surface-strong/72'
                }`}
              >
                {TYPE_LABEL[type]}
                {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
              </button>
            );
          })}
          <IconButton
            onClick={toggleTimestamps}
            active={showTimestamps}
            title={showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
          >
            <Clock size={13} />
          </IconButton>
          <IconButton onClick={clear} title="Clear console" tone="danger">
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
          <p className="px-2 pt-2 italic text-muted">
            {entries.length === 0
              ? 'Output will appear here...'
              : 'No entries match the active filters.'}
          </p>
        ) : (
          visibleEntries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} showTimestamps={showTimestamps} />
          ))
        )}
      </div>
    </div>
  );
}
