/**
 * FASE 0 — Signal-Slate recipe: ResultHeader.
 *
 * The shared status/meta/tabs bar that sits atop every result surface
 * (HTTP response, SQL result table, notebook cell output). Status chip
 * first, mono meta (timing · size), then an optional right-aligned tab
 * group, then an optional trailing slot.
 *
 * Translated from `redesign-after.jsx` (`ResultsPatternAfter`, the
 * SHARED result header). The inline `oklch` palette maps onto DS tokens
 * (`bg-bg-inset`, `border-border-subtle`, `bg-bg-panel-alt`); padding
 * (9px), meta (11px mono), and tab sizing (11.5px) are from that mockup.
 *
 * Deviation from the mockup, intentional: the proposal renders the tabs
 * as inert `<span>`s. This primitive promotes them to real `<button>`s
 * with a focus-visible ring and `aria-pressed`, per the FASE 0 a11y
 * rule (every interactive element must be keyboard-reachable). The
 * focus ring reuses the slate accent like `.field-shell`.
 *
 * PRIMITIVE: `status`, tab labels, and `trailing` come from the caller.
 */

import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface ResultHeaderTab {
  id: string;
  label: ReactNode;
}

export interface ResultHeaderProps {
  /** Leading status indicator (typically a `<StatusBadge>`). */
  status: ReactNode;
  /** Mono metadata line, e.g. "340 ms · 83 B". */
  meta?: string;
  /** Optional tab group, right-aligned. */
  tabs?: ReadonlyArray<ResultHeaderTab>;
  /** Currently-active tab id. */
  activeTab?: string;
  /** Fired with the picked tab id. */
  onTabChange?: (id: string) => void;
  /** Optional far-right slot (e.g. a copy button). */
  trailing?: ReactNode;
  className?: string;
}

export function ResultHeader({
  status,
  meta,
  tabs,
  activeTab,
  onTabChange,
  trailing,
  className,
}: ResultHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-[10px] border-b border-border-subtle bg-bg-inset px-3 py-[9px]',
        className
      )}
    >
      {status}
      {meta ? <span className="font-mono text-caption text-fg-subtle">{meta}</span> : null}
      {tabs && tabs.length > 0 ? (
        <div className="ml-auto flex gap-1">
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => onTabChange?.(tab.id)}
                className={cn(
                  'rounded-sm px-[9px] py-[3px] text-caption transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-inset',
                  active
                    ? 'bg-bg-panel-alt font-semibold text-fg-base'
                    : 'text-fg-subtle hover:text-fg-base'
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {trailing ? (
        <span className={cn('shrink-0', tabs && tabs.length > 0 ? '' : 'ml-auto')}>
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
