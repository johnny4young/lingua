import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="panel-title">{title}</h3>
        {description && <p className="text-sm leading-6 text-muted">{description}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

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
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-[1.35rem] border border-border/80 bg-background-elevated/72 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>}
      </div>
      <div className="sm:max-w-[58%]">{children}</div>
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={onChange}
      className={cn(
        'relative h-7 w-12 rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        value
          ? 'border-primary/30 bg-primary'
          : 'border-border/80 bg-surface-strong/80'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-[1.375rem] w-[1.375rem] rounded-full bg-white shadow transition-transform',
          value ? 'translate-x-[1.35rem]' : 'translate-x-0.5'
        )}
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
      className={cn('button-secondary h-10 w-10 px-0 text-sm', className)}
      {...props}
    >
      {children}
    </button>
  );
}
