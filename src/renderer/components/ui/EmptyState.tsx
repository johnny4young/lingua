import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface EmptyStateProps {
  /** Glyph rendered inside the accent tile (e.g. a lucide icon). */
  icon: ReactNode;
  title: ReactNode;
  /** Optional supporting line. Omit (or pass null) for a title-only state. */
  description?: ReactNode;
  /** Optional CTA row beneath the description. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('mx-auto flex max-w-[260px] flex-col items-center text-center', className)}>
      <span className="mb-[14px] grid h-10 w-10 place-items-center rounded-lg border border-border-subtle bg-bg-inset text-accent">
        {icon}
      </span>
      <div className="text-[14.5px] font-semibold text-fg-base">{title}</div>
      {description ? (
        <div className="mt-[6px] text-[12.5px] leading-relaxed text-fg-subtle">{description}</div>
      ) : null}
      {action ? <div className="mt-[14px]">{action}</div> : null}
    </div>
  );
}
