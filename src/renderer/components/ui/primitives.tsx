/**
 * RL-070 Sub-slice 1 — Signal-Slate UI primitives.
 *
 * Low-level building blocks the design system uses everywhere:
 * `Eyebrow` (uppercase section label), `RowDense` (label/hint/control
 * row), `Pill` (status pills with semantic tones), `Btn` (button with
 * `kind` variants), `DenseSection` (Eyebrow + description + items).
 * These compose into Settings, Utilities, Toast, Shortcuts, Changelog,
 * etc. Existing `Row`/`Section`/`Toggle`/`Select` in
 * `components/Settings/shared.tsx` keep working unchanged so callers
 * migrate at their own pace.
 *
 * All tokens are CSS variables sourced from `src/renderer/index.css`,
 * which mirrors the design-system bundle (`ds/_shared/tokens.css`).
 * This file should not introduce hard-coded hex / oklch values.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

/* ---------------------------------------------- Eyebrow */

/**
 * Uppercase, tracked label that sits above a section heading. Always
 * use sentence case in the source — the CSS uppercases it. Tracked
 * 0.16em / size 10.5px / weight 600 per the DS type ramp.
 */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'mb-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted',
        className
      )}
    >
      {children}
    </p>
  );
}

/* ---------------------------------------------- DenseSection */

/**
 * Standard section pattern across the DS:
 * `<Eyebrow>` + optional description + items stacked tight.
 *
 * The "dense" name distinguishes it from the legacy
 * `<Section>` in Settings/shared.tsx which used cards with thicker
 * spacing. Dense is the new default — keeps Settings readable
 * without scrolling, lets Utilities pack 19 entries without
 * wasting vertical space.
 */
export function DenseSection({
  eyebrow,
  description,
  children,
  className,
}: {
  eyebrow: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('first:mt-0 mt-7', className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      {description ? (
        <p className="mb-3 max-w-[60ch] text-[12px] leading-5 text-muted">{description}</p>
      ) : null}
      {children}
    </section>
  );
}

/* ---------------------------------------------- RowDense */

/**
 * Label/hint pair on the left, control on the right, separated by a
 * thin border-bottom. Replaces the heavier `Row` in
 * Settings/shared.tsx for surfaces that need many rows in a single
 * column (Settings tabs, JWT debugger details).
 */
export function RowDense({
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
        'flex items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-b-0',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium leading-tight text-foreground">{label}</p>
        {hint ? (
          <p className="mt-1 max-w-[44ch] text-[11.5px] leading-[1.45] text-muted">{hint}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/* ---------------------------------------------- Pill */

export type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info';

const pillToneClasses: Record<PillTone, string> = {
  neutral: 'border-border/80 bg-surface-strong/75 text-muted',
  accent: 'border-primary/30 bg-primary-soft text-primary',
  success: 'border-success/35 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/12 text-warning',
  error: 'border-error/40 bg-error/12 text-error',
  info: 'border-info/35 bg-info/12 text-info',
};

/**
 * Status pill / tag. Always uppercase, tracked. Use `tone="success"`
 * for positive states (Active, Up to date), `warning` for transient
 * notice (Grace period), `error` for failures, `info` for neutral
 * informational chips, `accent` for branded badges (Pro, Education).
 */
export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: PillTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]',
        pillToneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------- Btn */

export type BtnKind = 'primary' | 'secondary' | 'ghost' | 'danger';
export type BtnSize = 'sm' | 'md';

const btnKindClasses: Record<BtnKind, string> = {
  primary: 'button-primary',
  secondary: 'button-secondary',
  ghost: 'button-ghost',
  danger: 'button-danger',
};

const btnSizeClasses: Record<BtnSize, string> = {
  sm: 'h-7 px-2.5 text-[11px]',
  md: '',
};

/**
 * Wraps the existing `.button-*` CSS classes so React callers don't
 * need to know about the className soup. Use `<Btn kind="primary">`
 * over raw `<button className="button-primary">`.
 */
export function Btn({
  kind = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: { kind?: BtnKind; size?: BtnSize } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={rest.type ?? 'button'}
      className={cn(btnKindClasses[kind], btnSizeClasses[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------- Display heading */

/**
 * 22-28px tracked-tight section heading (h1/h2 in the DS type ramp).
 * Use for overlay titles ("Workspace configuration", "License
 * recovery received"). For single-screen titles, prefer the
 * shadow-less `text-h1` direct utility; this wrapper exists for
 * places that want the same look without redeclaring tokens.
 */
export function DisplayHeading({
  children,
  level = 'h1',
  className,
}: {
  children: ReactNode;
  level?: 'display' | 'h1' | 'h2';
  className?: string;
}) {
  const sizeClass =
    level === 'display'
      ? 'text-[40px] tracking-[-0.03em]'
      : level === 'h1'
        ? 'text-[22px] tracking-[-0.02em]'
        : 'text-[17px] tracking-[-0.015em]';
  return (
    <h2
      className={cn(
        'font-display font-semibold leading-[1.2] text-foreground',
        sizeClass,
        className
      )}
    >
      {children}
    </h2>
  );
}
