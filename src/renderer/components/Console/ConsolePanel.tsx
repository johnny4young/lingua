import { Clock, Trash2 } from 'lucide-react';
import { useConsoleStore } from '../../stores/consoleStore';
import { useEffect, useRef } from 'react';
import type { ConsoleEntry, ConsoleEntryType } from '../../types';

// ---------------------------------------------------------------------------
// ANSI escape-code parser
// ---------------------------------------------------------------------------

/** A single chunk of styled text produced by the ANSI parser */
interface AnsiSpan {
  text: string;
  color?: string;   // CSS color value, e.g. '#ff5555'
  bold?: boolean;
  dim?: boolean;
}

// Standard 16-color ANSI palette (foreground codes 30-37, 90-97)
const ANSI_FG: Record<number, string> = {
  30: '#4e4e4e', 31: '#ff5555', 32: '#55ff55', 33: '#ffff55',
  34: '#5555ff', 35: '#ff55ff', 36: '#55ffff', 37: '#cccccc',
  90: '#888888', 91: '#ff8888', 92: '#88ff88', 93: '#ffff88',
  94: '#8888ff', 95: '#ff88ff', 96: '#88ffff', 97: '#ffffff',
};

function parseAnsi(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  // Matches ESC[ ... m sequences
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let color: string | undefined;
  let bold = false;
  let dim = false;

  const push = (text: string) => {
    if (text) spans.push({ text, color, bold, dim });
  };

  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    push(raw.slice(last, m.index));
    last = m.index + m[0].length;

    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0) { color = undefined; bold = false; dim = false; }
      else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (ANSI_FG[code]) color = ANSI_FG[code];
    }
  }
  push(raw.slice(last));
  return spans;
}

function hasAnsi(s: string): boolean {
  return /\x1b\[/.test(s);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_LABEL: Record<ConsoleEntryType, string> = {
  log: 'LOG', info: 'INF', warn: 'WRN', error: 'ERR', result: 'RES',
};

const TYPE_COLOR: Record<ConsoleEntryType, string> = {
  log:    'text-gray-300',
  info:   'text-blue-400',
  warn:   'text-yellow-400',
  error:  'text-red-400',
  result: 'text-violet-400',
};

const TYPE_BADGE: Record<ConsoleEntryType, string> = {
  log:    'text-gray-500',
  info:   'text-blue-500',
  warn:   'text-yellow-500',
  error:  'text-red-500',
  result: 'text-violet-500',
};

const FILTER_TYPES: ConsoleEntryType[] = ['log', 'info', 'warn', 'error'];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatExecTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AnsiContent({ text, className }: { text: string; className: string }) {
  if (!hasAnsi(text)) {
    return <span className={`whitespace-pre-wrap ${className}`}>{text}</span>;
  }
  const spans = parseAnsi(text);
  return (
    <span className={`whitespace-pre-wrap ${className}`}>
      {spans.map((s, i) => (
        <span
          key={i}
          style={s.color ? { color: s.color } : undefined}
          className={s.bold ? 'font-bold' : s.dim ? 'opacity-50' : undefined}
        >
          {s.text}
        </span>
      ))}
    </span>
  );
}

function EntryRow({ entry, showTimestamps }: { entry: ConsoleEntry; showTimestamps: boolean }) {
  const labelCls = TYPE_BADGE[entry.type];
  const contentCls = TYPE_COLOR[entry.type];

  return (
    <div className="flex gap-2 py-0.5 hover:bg-gray-900/50 rounded px-1 group">
      {showTimestamps && (
        <span className="shrink-0 text-gray-600 select-none tabular-nums">
          {formatTime(entry.timestamp)}
        </span>
      )}
      <span className={`shrink-0 font-bold text-[10px] leading-5 ${labelCls} select-none`}>
        {TYPE_LABEL[entry.type]}
      </span>
      {entry.line !== undefined && (
        <span className="shrink-0 text-gray-600 select-none">L{entry.line}</span>
      )}
      <AnsiContent text={entry.content} className={contentCls} />
      {entry.executionTime !== undefined && (
        <span className="ml-auto shrink-0 text-gray-600 select-none tabular-nums">
          {formatExecTime(entry.executionTime)}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConsolePanel() {
  const { entries, activeFilters, showTimestamps, clear, toggleFilter, toggleTimestamps } =
    useConsoleStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  // Auto-scroll: only if the user hasn't manually scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrolled.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    userScrolled.current = !atBottom;
  };

  const visible = entries.filter((e) => activeFilters.has(e.type));

  return (
    <div className="flex h-full flex-col bg-gray-950">
      {/* Toolbar */}
      <div className="flex h-8 items-center justify-between border-b border-gray-800 px-2 gap-2">
        <span className="text-xs font-medium text-gray-400 shrink-0">Console</span>

        {/* Filter pills */}
        <div className="flex items-center gap-1">
          {FILTER_TYPES.map((t) => {
            const active = activeFilters.has(t);
            const count = entries.filter((e) => e.type === t).length;
            return (
              <button
                key={t}
                onClick={() => toggleFilter(t)}
                title={`Toggle ${t} output`}
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-4 transition-colors ${
                  active
                    ? `${TYPE_BADGE[t]} bg-gray-800`
                    : 'text-gray-700 hover:text-gray-500'
                }`}
              >
                {TYPE_LABEL[t]}
                {count > 0 && (
                  <span className="ml-0.5 text-[9px] opacity-70">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={toggleTimestamps}
            title={showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
            className={`rounded p-1 transition-colors ${
              showTimestamps
                ? 'text-blue-400 hover:bg-gray-800'
                : 'text-gray-600 hover:bg-gray-800 hover:text-gray-400'
            }`}
          >
            <Clock size={12} />
          </button>
          <button
            onClick={clear}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
            title="Clear console"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Output area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 py-1 font-mono text-xs leading-5"
      >
        {visible.length === 0 ? (
          <p className="text-gray-600 italic px-1 pt-1">
            {entries.length === 0
              ? 'Output will appear here...'
              : 'No entries match the active filters.'}
          </p>
        ) : (
          visible.map((entry) => (
            <EntryRow key={entry.id} entry={entry} showTimestamps={showTimestamps} />
          ))
        )}
      </div>
    </div>
  );
}
