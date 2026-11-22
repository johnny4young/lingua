import { useTranslation } from 'react-i18next';
import type { RichOutputPayload } from '../../../shared/richOutput';
import type { ConsoleEntry, ConsoleEntryType } from '../../types/console';
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

/** Rows whose payloads are plain values print their text, as a terminal would. */
function hasRichPayload(payload: readonly RichOutputPayload[] | null): payload is RichOutputPayload[] {
  return payload !== null && payload.some(p => p.kind !== 'primitive' && p.kind !== 'rawText');
}

interface ConsoleEntryRowProps {
  entry: ConsoleEntry;
  /** Run offset (`+0.44 s`) when the row has one; the clock time otherwise. */
  runOffset: string | null;
  showTimestamps: boolean;
  typeLabel: Record<ConsoleEntryType, string>;
  /** Number of collapsed duplicate entries. */
  repeatCount: number;
  /** Source line already resolved from the rich payload or legacy entry line. */
  sourceLine: number | null;
  /** Matching rows pulse while the editor cursor settles. */
  pulseTargetLine: number | null;
  /** Per-tab origin opt-out shared with the rich-render badge path. */
  originSuppressed: boolean;
  /** Multi-line output shows its first line until unfolded. */
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
  /** Set on a previous-run row still standing in for output this run has not reached. */
  ghostRun?: number;
}

/** One tape row: source line, the call's output, and its offset into the run. */
export function ConsoleEntryRow({
  entry,
  runOffset,
  showTimestamps,
  typeLabel,
  repeatCount,
  sourceLine,
  pulseTargetLine,
  originSuppressed,
  expanded,
  onToggleExpanded,
  ghostRun,
}: ConsoleEntryRowProps) {
  const { t } = useTranslation();
  const payload = Array.isArray(entry.payload) ? entry.payload : null;
  const richPayload = hasRichPayload(payload) ? payload : null;
  const ghost = ghostRun !== undefined;
  const isPulsing =
    !ghost && !originSuppressed && pulseTargetLine !== null && sourceLine === pulseTargetLine;
  const lines = richPayload ? [] : entry.content.split('\n');
  // Errors stay unfolded: the trace is the point of the row.
  const foldable = lines.length > 1 && entry.type !== 'error';
  const text = foldable && !expanded ? (lines[0] ?? '') : entry.content;
  const color = ghost ? 'text-fg-subtle' : ENTRY_TYPE_COLOR[entry.type];

  return (
    <div
      className="group flex min-h-[22px] items-start pr-4 hover:bg-surface-strong/52"
      data-testid={ghost ? 'console-ghost-row' : 'console-entry-row'}
      data-entry-type={entry.type}
      data-pulsing={isPulsing ? 'true' : undefined}
    >
      <span className="w-[46px] shrink-0 select-none pr-3 text-right text-[11px] leading-[22px]">
        {sourceLine !== null && !originSuppressed ? (
          <OutputLineBadge
            origin={{ line: sourceLine }}
            language={entry.language ?? 'unknown'}
          />
        ) : null}
      </span>
      <span className="sr-only">{typeLabel[entry.type]}</span>
      <div className={`min-w-0 flex-1 leading-[22px] ${color}`}>
        {richPayload ? (
          <ConsoleEntryRenderer
            payloads={richPayload}
            fallbackText={entry.content}
            language={entry.language}
          />
        ) : (
          <AnsiContent text={text} className={color} />
        )}
        {foldable ? (
          <button
            type="button"
            aria-expanded={expanded}
            data-testid="console-fold-toggle"
            onClick={() => onToggleExpanded(entry.id)}
            className="focus-ring ml-3 select-none rounded font-sans text-[11px] text-fg-muted hover:text-foreground"
          >
            {expanded
              ? t('console.tape.fold')
              : t('console.tape.moreLines', { count: lines.length - 1 })}
          </button>
        ) : null}
      </div>
      {repeatCount > 1 && (
        <span
          className="ml-2 mt-[3px] shrink-0 select-none rounded-full border border-border/60 px-1.5 font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle"
          data-testid="console-repeat-count"
          title={`×${repeatCount}`}
        >
          ×{repeatCount}
        </span>
      )}
      {ghost ? (
        <span
          className="ml-4 shrink-0 select-none font-sans text-[11px] leading-[22px] text-fg-subtle"
          title={t('console.tape.ghostTitle', { number: ghostRun })}
        >
          {t('console.tape.ghostRun', { number: ghostRun })}
        </span>
      ) : showTimestamps ? (
        <span
          className="ml-4 shrink-0 select-none text-[11px] leading-[22px] tabular-nums text-fg-subtle"
          data-testid="console-row-stamp"
        >
          {runOffset ?? formatTime(entry.timestamp)}
        </span>
      ) : null}
    </div>
  );
}
