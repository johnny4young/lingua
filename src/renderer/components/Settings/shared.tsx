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
        'relative inline-flex h-5 w-9 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        value ? 'bg-accent' : 'bg-border-strong',
        disabled && 'cursor-not-allowed opacity-40'
      )}
      style={{ transition: 'background-color var(--duration-fast) var(--curve-ease-out)' }}
    >
      {/* 36×20 track, 16px knob; on and off differ only by the track colour. */}
      <span
        className="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow-e1"
        style={{
          transform: `translateX(${value ? 16 : 0}px)`,
          transition: 'transform var(--duration-fast) var(--curve-ease-out)',
        }}
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
