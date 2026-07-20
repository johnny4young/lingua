import type { ConsoleEntry, ConsoleEntryType } from '../../types';
import { formatExecTime } from '../../hooks/runnerOutput';
import { ConsoleEntryRenderer } from './ConsoleEntryRenderer';
import { OutputLineBadge } from './OutputLineBadge';

interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/**
 * ANSI foreground codes routed through the DS canonical console tokens. Bright
 * variants deliberately collapse to the same semantic role as their regular
 * counterpart; any future distinction belongs in the shared token set.
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

const ENTRY_TYPE_COLOR: Record<ConsoleEntryType, string> = {
  log: 'text-foreground',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-error',
  result: 'text-primary',
};

const ENTRY_TYPE_BADGE: Record<ConsoleEntryType, string> = {
  log: 'text-muted',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-error',
  result: 'text-primary',
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

function AnsiContent({ text, className }: { text: string; className: string }) {
  // eslint-disable-next-line no-control-regex
  if (!/\x1b\[/.test(text)) {
    return <span className={`whitespace-pre-wrap ${className}`}>{text}</span>;
  }

  return (
    <span className={`whitespace-pre-wrap ${className}`}>
      {parseAnsi(text).map((span, index) => (
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

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface ConsoleEntryRowProps {
  entry: ConsoleEntry;
  showTimestamps: boolean;
  typeLabel: Record<ConsoleEntryType, string>;
  /** implementation note — number of collapsed duplicate entries. */
  repeatCount: number;
  /** Source line already resolved from the rich payload or legacy entry line. */
  sourceLine: number | null;
  /** implementation — matching rows pulse while the editor cursor settles. */
  pulseTargetLine: number | null;
  /** Per-tab origin opt-out shared with the rich-render badge path. */
  originSuppressed: boolean;
}

/** Visual row for one collapsed console entry; store and window orchestration stay in the panel. */
export function ConsoleEntryRow({
  entry,
  showTimestamps,
  typeLabel,
  repeatCount,
  sourceLine,
  pulseTargetLine,
  originSuppressed,
}: ConsoleEntryRowProps) {
  const payload = Array.isArray(entry.payload) ? entry.payload : null;
  const usesRichRender = payload !== null && payload.length > 0;
  const rowOrigin = sourceLine !== null ? { line: sourceLine } : null;
  const isPulsing =
    !originSuppressed && pulseTargetLine !== null && sourceLine === pulseTargetLine;

  return (
    <div
      className="group flex gap-3 rounded-4xl px-2 py-1.5 hover:bg-surface-strong/52"
      data-testid="console-entry-row"
      data-pulsing={isPulsing ? 'true' : undefined}
    >
      {showTimestamps && (
        <span className="shrink-0 select-none tabular-nums text-muted">
          {formatTime(entry.timestamp)}
        </span>
      )}
      <span
        className={`shrink-0 select-none font-bold text-eyebrow leading-5 ${ENTRY_TYPE_BADGE[entry.type]}`}
      >
        {typeLabel[entry.type]}
      </span>
      {rowOrigin && !originSuppressed && !usesRichRender && (
        <span className="shrink-0">
          <OutputLineBadge origin={rowOrigin} language={entry.language ?? 'unknown'} />
        </span>
      )}
      {usesRichRender && payload !== null ? (
        <div className={ENTRY_TYPE_COLOR[entry.type]}>
          <ConsoleEntryRenderer
            payloads={payload}
            fallbackText={entry.content}
            language={entry.language}
            entryLine={entry.line}
            originSuppressed={originSuppressed}
          />
        </div>
      ) : (
        <AnsiContent text={entry.content} className={ENTRY_TYPE_COLOR[entry.type]} />
      )}
      {repeatCount > 1 && (
        <span
          className="shrink-0 select-none rounded-full border border-border/60 px-1.5 font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle"
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
