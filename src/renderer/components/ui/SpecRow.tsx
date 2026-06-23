import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../../utils/cn';

/* -------------------------------------------------------------- SpecRow */

export interface SpecRowProps {
  /** Left-column label. */
  label: ReactNode;
  /** Optional supporting line under the label. */
  description?: ReactNode;
  /** Right-column control (toggle, select, stepper, value, …). */
  control: ReactNode;
  /** When true, drops the bottom hairline (last row in a card). */
  last?: boolean;
}

export function SpecRow({ label, description, control, last = false }: SpecRowProps) {
  const labelId = useId();
  const onlyControl = Children.count(control) === 1 ? Children.only(control) : null;
  const labelledControl =
    isValidElement(onlyControl) &&
    !(onlyControl.props as { 'aria-label'?: string })['aria-label'] &&
    !(onlyControl.props as { 'aria-labelledby'?: string })['aria-labelledby']
      ? cloneElement(onlyControl as ReactElement<{ 'aria-labelledby'?: string }>, {
          'aria-labelledby': labelId,
        })
      : control;

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-[13px]',
        last ? '' : 'border-b border-border-subtle'
      )}
    >
      <div className="min-w-0">
        <div
          id={labelId}
          className={cn(
            'text-body',
            // A described row leans on a heavier, higher-contrast label;
            // a bare metadata row stays quiet. Mirrors the mockup's
            // `fontWeight: desc ? 550 : 450` / `color: desc ? fg : fgMut`.
            description ? 'font-medium text-fg-base' : 'font-normal text-fg-muted'
          )}
        >
          {label}
        </div>
        {description ? (
          <div className="mt-[2px] text-caption text-fg-subtle">{description}</div>
        ) : null}
      </div>
      <div className="shrink-0">{labelledControl}</div>
    </div>
  );
}

/* ------------------------------------------------------------- SpecCard */

export interface SpecCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * The inset surface that groups `SpecRow`s. Vertical padding is the
 * tight `py-1` from the mockup so the first/last row hairlines breathe
 * without doubling the gap.
 */
export function SpecCard({ children, className }: SpecCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border-subtle bg-bg-inset px-[18px] py-1',
        className
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------- SettingsSection */

export interface SettingsSectionProps {
  /** Uppercase mono section label (rendered as-is; CSS does not case it). */
  eyebrow: ReactNode;
  /** Optional intro paragraph under the eyebrow. */
  description?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({ eyebrow, description, children }: SettingsSectionProps) {
  return (
    <section className="flex flex-col gap-[14px]">
      <div>
        <h3 className="font-mono text-eyebrow font-semibold uppercase text-fg-muted">
          {eyebrow}
        </h3>
        {description ? (
          <p className="mt-[6px] text-body leading-relaxed text-fg-subtle">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
