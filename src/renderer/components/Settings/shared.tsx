import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '../../utils/cn';

export function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="space-y-2.5">
      <div className="space-y-1">
        <h3 className="panel-title">{title}</h3>
        {description && <p className="text-sm leading-6 text-muted">{description}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/**
 * RL-088 — Row binds its visible label to the interactive control
 * inside `children` for screen readers. When `children` is a single
 * React element that has not declared its own `aria-label` or
 * `aria-labelledby`, Row clones it with `aria-labelledby` pointing at
 * the visual label paragraph (which gets a stable `useId`). Multi-
 * child clusters (button groups, action rows) are passed through
 * unchanged.
 */
export function Row({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const labelId = useId();

  const onlyChild = Children.count(children) === 1 ? Children.only(children) : null;
  const labelledChildren =
    isValidElement(onlyChild) &&
    !(onlyChild.props as { 'aria-label'?: string })['aria-label'] &&
    !(onlyChild.props as { 'aria-labelledby'?: string })['aria-labelledby']
      ? cloneElement(onlyChild as ReactElement<{ 'aria-labelledby'?: string }>, {
          'aria-labelledby': labelId,
        })
      : children;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-[1.15rem] border border-border/80 bg-background-elevated/72 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </p>
        {hint && <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>}
      </div>
      {/*
       * RL-044 Slice 2b-β-α Prerequisite fix — Settings panel vertical
       * alignment. Previously the right column used
       * `sm:max-w-[52%] sm:min-w-[11rem]`, so its width tracked the
       * intrinsic width of whatever control it held: textareas fanned
       * out to 52%, toggles shrunk to 11rem, single-line inputs +
       * buttons rendered narrower still. Because the parent row uses
       * `justify-between`, the right column's RIGHT edge sat at the
       * row's right padding while its LEFT edge moved around with
       * content — producing a ragged staircase down the Settings
       * surface that the user flagged on Account.
       *
       * Fixed width `sm:w-80` (20rem / 320px) + `sm:shrink-0` snaps
       * every right column to the same left edge across all 54 Row
       * usages. Narrow controls (Toggle, single-button rows) sit at
       * the left of the column with empty space to their right —
       * a small cosmetic trade-off in exchange for a clean alignment
       * grid. Wide controls (textareas, inline sub-grids like
       * Execution timeout's per-language Select stack) fill the
       * 320px container at `w-full` and stay readable.
       */}
      <div className="sm:w-80 sm:shrink-0">{labelledChildren}</div>
    </div>
  );
}

export function Toggle({
  value,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'data-testid': testId,
}: {
  value: boolean;
  onChange: () => void;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : ariaLabelledBy}
      data-testid={testId}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-[32px] w-[56px] shrink-0 rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        value
          ? 'border-primary/30 bg-primary'
          : 'border-border/80 bg-surface-strong/80',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      <span
        className="absolute left-[2px] top-1/2 h-[28px] w-[28px] rounded-full bg-white shadow-[0_4px_14px_rgba(15,23,42,0.25)] transition-transform"
        style={{ transform: `translate(${value ? 24 : 0}px, -50%)` }}
      />
    </button>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('field-shell pr-9 text-sm', props.className)} {...props} />;
}

export function StepperButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={props.type ?? 'button'}
      className={cn('button-secondary h-9 w-9 px-0 text-sm', className)}
      {...props}
    >
      {children}
    </button>
  );
}
