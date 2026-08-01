import type {
  ButtonHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
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
        {description && <p className="text-body leading-6 text-muted">{description}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
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
        className="absolute left-[2px] top-1/2 h-[28px] w-[28px] rounded-full bg-white shadow-[var(--shadow-md)] transition-transform"
        style={{ transform: `translate(${value ? 24 : 0}px, -50%)` }}
      />
    </button>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('field-shell pr-9 text-body', props.className)} {...props} />;
}

export function StepperButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={props.type ?? 'button'}
      className={cn('button-secondary h-9 w-9 px-0 text-body', className)}
      {...props}
    >
      {children}
    </button>
  );
}
