import { ChevronDown, Play, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface RuntimeLanguageGlyph {
  /** Short uppercase tag, e.g. "JS". */
  label: ReactNode;
  /** Token background utility, e.g. "bg-slate-500". Defaults to slate. */
  className?: string;
}

export interface RuntimeSelectorProps {
  languageLabel: ReactNode;
  languageGlyph?: RuntimeLanguageGlyph;
  onPickLanguage?: () => void;
  modeLabel: ReactNode;
  onPickMode?: () => void;
  onRun: () => void;
  running?: boolean;
  /**
   * Run-segment label (i18n copy from the caller). Optional so the
   * primitive never hardcodes a string; when omitted the play icon
   * alone signals the action.
   */
  runLabel?: ReactNode;
  /** Label shown while `running` (i18n copy). Falls back to `runLabel`. */
  stopLabel?: ReactNode;
  /** Optional keycap shown on the run segment when idle, e.g. "⌘↵". */
  runShortcut?: ReactNode;
  disabled?: boolean;
}

const SEGMENT_BASE =
  'inline-flex min-h-10 items-center text-[12.5px] transition-colors focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-45';

export function RuntimeSelector({
  languageLabel,
  languageGlyph,
  onPickLanguage,
  modeLabel,
  onPickMode,
  onRun,
  running = false,
  runLabel,
  stopLabel,
  runShortcut,
  disabled = false,
}: RuntimeSelectorProps) {
  const activeLabel = running ? stopLabel ?? runLabel : runLabel;
  return (
    <div className="inline-flex items-stretch self-start overflow-hidden rounded-lg border border-border-subtle bg-bg-inset">
      {/* LANGUAGE segment */}
      <button
        type="button"
        onClick={onPickLanguage}
        disabled={disabled}
        className={cn(
          SEGMENT_BASE,
          'gap-[7px] border-r border-border-subtle px-3 py-[7px] text-fg-base hover:bg-bg-panel-alt'
        )}
      >
        {languageGlyph ? (
          <span
            className={cn(
              'rounded-sm px-1 py-[2px] font-mono text-[8.5px] font-bold text-fg-on-accent',
              languageGlyph.className ?? 'bg-slate-500'
            )}
          >
            {languageGlyph.label}
          </span>
        ) : null}
        {languageLabel}
        <ChevronDown size={12} className="text-fg-subtle" aria-hidden />
      </button>

      {/* MODE segment */}
      <button
        type="button"
        onClick={onPickMode}
        disabled={disabled}
        className={cn(
          SEGMENT_BASE,
          'gap-[7px] border-r border-border-subtle px-3 py-[7px] text-fg-base hover:bg-bg-panel-alt'
        )}
      >
        {modeLabel}
        <ChevronDown size={12} className="text-fg-subtle" aria-hidden />
      </button>

      {/* RUN segment — the one sanctioned green action. */}
      <button
        type="button"
        onClick={onRun}
        disabled={disabled}
        data-running={running ? 'true' : 'false'}
        className={cn(
          SEGMENT_BASE,
          'gap-[7px] bg-success-fg px-[14px] py-[7px] font-medium text-fg-on-accent',
          running ? 'animate-glow-pulse' : 'hover:opacity-90'
        )}
      >
        {running ? <Square size={11} aria-hidden /> : <Play size={11} aria-hidden />}
        {activeLabel ? <span>{activeLabel}</span> : null}
        {!running && runShortcut ? (
          <kbd className="inline-flex items-center gap-1 rounded-sm bg-fg-on-accent/15 px-1.5 py-0.5 font-mono text-[10.5px] font-medium leading-none">
            {runShortcut}
          </kbd>
        ) : null}
      </button>
    </div>
  );
}
