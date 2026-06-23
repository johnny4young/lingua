import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export type StatusBadgeTone =
  | 'free'
  | 'pro'
  | 'unsaved'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'neutral';

const toneClasses: Record<StatusBadgeTone, string> = {
  free: 'bg-transparent text-fg-muted border-border',
  pro: 'bg-slate-100 text-accent-fg border-slate-300',
  unsaved: 'bg-warning-bg text-warning-fg border-warning-border',
  success: 'bg-success-bg text-success-fg border-success-border',
  error: 'bg-error-bg text-error-fg border-error-border',
  warning: 'bg-warning-bg text-warning-fg border-warning-border',
  info: 'bg-info-bg text-info-fg border-info-border',
  neutral: 'bg-bg-panel-alt text-fg-muted border-border-subtle',
};

export interface StatusBadgeProps {
  tone: StatusBadgeTone;
  /** Leading 5px dot tinted to the tone's foreground (via `bg-current`). */
  dot?: boolean;
  children: ReactNode;
}

export function StatusBadge({ tone, dot = false, children }: StatusBadgeProps) {
  return (
    <span
      data-status-tone={tone}
      className={cn(
        'inline-flex items-center gap-[5px] whitespace-nowrap rounded-sm border px-2 py-[3px]',
        'font-mono text-micro font-semibold uppercase leading-[1.3]',
        toneClasses[tone]
      )}
    >
      {dot ? (
        <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}
