import { cn } from '../../utils/cn';

export interface InlineMarkerProps {
  /** The evaluated value, e.g. "50". */
  value: string;
  /** The runtime type tag, e.g. "number". */
  type: string;
  /** When set, prepends the accent @WATCH marker. */
  watch?: boolean;
  className?: string;
}

export function InlineMarker({ value, type, watch = false, className }: InlineMarkerProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-[5px] bg-bg-inset/60 py-[3px] pl-[9px] pr-1 font-mono text-[11.5px]',
        className
      )}
    >
      {watch ? <code className="text-[9.5px] text-accent">@WATCH</code> : null}
      <span className="font-semibold text-fg-base">{value}</span>
      <span className="border-l border-border-subtle pl-2 text-[9.5px] uppercase text-fg-subtle">
        {type}
      </span>
    </span>
  );
}
