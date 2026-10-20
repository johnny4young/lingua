import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  /** Stable target used by Settings search to scroll and focus this row. */
  searchTargetId?: string;
  /** Marks a Pro-only row with a lock badge after the label. */
  pro?: boolean;
}

export function SpecRow({
  label,
  description,
  control,
  last = false,
  searchTargetId,
  pro = false,
}: SpecRowProps) {
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
      data-settings-search-target={searchTargetId}
      tabIndex={searchTargetId ? -1 : undefined}
      className={cn(
        'spec-row flex justify-between gap-4 rounded-md py-2.5 outline-none',
        searchTargetId && 'focus:ring-2 focus:ring-accent/70 focus:ring-offset-2 focus:ring-offset-bg-base',
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
          {pro ? <ProBadge /> : null}
        </div>
        {description ? (
          <div className="mt-[2px] max-w-[70ch] text-caption leading-snug text-fg-subtle">
            {description}
          </div>
        ) : null}
      </div>
      <div className="spec-row-control ml-auto flex shrink-0 flex-col items-end">
        {labelledControl}
      </div>
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
        'rounded-[10px] border border-border-subtle bg-bg-panel px-4',
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
  /** Short name in the tab's section chips; defaults to a string eyebrow. */
  chip?: string;
  children: ReactNode;
}

export function SettingsSection({ eyebrow, description, chip, children }: SettingsSectionProps) {
  return (
    <section
      className="flex flex-col gap-2.5"
      data-settings-chip={chip ?? (typeof eyebrow === 'string' ? eyebrow : undefined)}
    >
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

/* ------------------------------------------------------------ Pro rows */

/** The lock badge after a Pro-only row's label. */
function ProBadge() {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'ml-2 inline-flex h-[18px] items-center gap-1 rounded-sm border px-1.5 align-middle',
        'border-warning-border bg-warning-bg text-warning-fg',
        'font-mono text-eyebrow font-semibold uppercase'
      )}
    >
      <Lock size={9} aria-hidden />
      {t('settings.pro.badge')}
    </span>
  );
}

/** The Free-tier control of a Pro-only row: a text link to the upsell. */
export function UnlockProLink({
  onClick,
  testId,
}: {
  onClick: () => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'text-body-sm font-semibold text-accent underline-offset-2',
        'hover:text-accent-fg hover:underline'
      )}
    >
      {t('settings.pro.unlock')}
    </button>
  );
}
