import type React from 'react';
import { useCallback, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from './CopyButton';
import {
  findDeveloperUtility,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import { useRegisterUtilityApply } from '../../hooks/useRegisterUtilityOutput';

export function PanelSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-[1.4rem] border border-border/80 bg-surface/58 p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs leading-5 text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{children}</label>;
}

export function UtilityTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-36 w-full rounded-[1.15rem] border border-border/80 bg-background/88 px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50 ${
        props.className ?? ''
      }`}
    />
  );
}

export function UtilityInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50 ${
        props.className ?? ''
      }`}
    />
  );
}

export function StatusMessage({
  message,
  tone = 'muted',
  testid,
  className,
}: {
  message: string;
  tone?: 'muted' | 'error' | 'success' | 'warning';
  /** Optional data-testid so callers can target a specific status line. */
  testid?: string;
  className?: string;
}) {
  const toneClass =
    tone === 'error'
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : tone === 'warning'
          ? 'text-warning'
          : 'text-muted';
  return (
    <p className={`text-xs leading-5 ${toneClass} ${className ?? ''}`} data-testid={testid}>
      {message}
    </p>
  );
}

export function JsonTreeNode({
  label,
  value,
}: {
  label?: string;
  value: unknown;
}) {
  if (Array.isArray(value)) {
    return (
      <div className="grid gap-2 pl-4">
        <div className="text-xs font-medium text-foreground">
          {label ? `${label}: ` : ''}
          <span className="text-muted">[{value.length}]</span>
        </div>
        <div className="grid gap-2 border-l border-border/70 pl-3">
          {value.map((entry, index) => (
            <JsonTreeNode key={`${label ?? 'array'}-${index}`} label={String(index)} value={entry} />
          ))}
        </div>
      </div>
    );
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="grid gap-2 pl-4">
        <div className="text-xs font-medium text-foreground">
          {label ? `${label}: ` : ''}
          <span className="text-muted">{'{'}{entries.length}{'}'}</span>
        </div>
        <div className="grid gap-2 border-l border-border/70 pl-3">
          {entries.map(([key, entry]) => (
            <JsonTreeNode key={`${label ?? 'object'}-${key}`} label={key} value={entry} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs text-foreground">
      {label ? <span className="font-medium text-foreground">{label}: </span> : null}
      <span className="text-muted">{String(value)}</span>
    </div>
  );
}

/**
 * RL-069 Slice 2 — Shared toolbar that renders the ⚡ Apply-from-input
 * button and self-registers the panel's apply descriptor with the
 * global Mod+Shift+A handler. Centralising the layout AND the
 * registration keeps panel boilerplate to a single JSX line and stops
 * Tailwind drift across 27 panels.
 *
 * The toolbar reads `detect` from the catalog by id, evaluates it
 * against `primary` / `secondary`, and exposes `enabled` to both the
 * button and the global shortcut. The hook is always called (React's
 * rules-of-hooks forbids conditional invocation), but when `detect`
 * is absent the registered descriptor returns `enabled: false`, the
 * Apply button is hidden, and Mod+Shift+A surfaces the
 * `applyUnavailable` toast. The pure-generator panels (random-string,
 * lorem-ipsum) skip the toolbar entirely — they keep their existing
 * Generate buttons as the canonical action.
 */
export function UtilityToolbar({
  utilityId,
  primary,
  secondary,
  run,
  applyTestId = 'utility-apply-button',
  className,
  children,
}: {
  utilityId: DeveloperUtilityId;
  primary: string;
  secondary?: string;
  run: () => void;
  applyTestId?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const definition = useMemo(() => findDeveloperUtility(utilityId), [utilityId]);
  const detect = definition.detect;
  const enabled = useMemo(() => {
    if (!detect) return false;
    try {
      return detect({ primary, secondary });
    } catch {
      return false;
    }
  }, [detect, primary, secondary]);

  const handleApply = useCallback(() => {
    if (!detect || !enabled) return;
    run();
  }, [detect, enabled, run]);

  // Stable handler the global Mod+Shift+A shortcut consults. Re-created
  // on every render so the captured `run` / `enabled` stay fresh — same
  // pattern as `useRegisterUtilityOutput` (Slice 1).
  const applyHandler = useCallback(
    () => ({
      enabled: detect ? enabled : false,
      toolNameKey: definition.titleKey,
      run: () => {
        if (!detect || !enabled) return;
        run();
      },
    }),
    [definition.titleKey, detect, enabled, run]
  );
  useRegisterUtilityApply(applyHandler);

  if (!detect) {
    // Generator panel — no Apply button, but still allow extras. This
    // keeps the toolbar API uniform across the catalog.
    if (!children) return null;
    return (
      <div
        data-testid="utility-toolbar"
        className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}
      >
        {children}
      </div>
    );
  }

  const labelKey = 'utilities.actions.applyFromInput';
  const tooltipKey = enabled
    ? 'utilities.actions.applyFromInput'
    : 'utilities.tooltip.applyUnavailable';
  return (
    <div
      data-testid="utility-toolbar"
      className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={handleApply}
        disabled={!enabled}
        data-testid={applyTestId}
        aria-label={t(labelKey)}
        title={t(tooltipKey)}
        className="inline-flex items-center gap-1.5 rounded-[0.95rem] border border-border/80 bg-background-elevated/88 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-strong/72 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Zap size={12} aria-hidden="true" />
        {t(labelKey)}
      </button>
      {children}
    </div>
  );
}

export function TwoPaneTransformPanel({
  title,
  description,
  input,
  onInputChange,
  output,
  errorKey,
}: {
  title: string;
  description: string;
  input: string;
  onInputChange: (value: string) => void;
  output: string;
  errorKey: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <PanelSection title={title} description={description}>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.input')}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
          />
        </div>
      </PanelSection>
      <PanelSection
        title={t('utilities.field.output')}
        description={errorKey ? t('utilities.status.invalid') : t('utilities.status.live')}
      >
        <div className="relative">
          <UtilityTextarea
            aria-label={t('utilities.field.output')}
            readOnly
            value={output}
            className={errorKey ? 'pr-10 text-danger' : 'pr-10'}
          />
          <div className="absolute right-2 top-2">
            <CopyButton value={output} disabled={!output || Boolean(errorKey)} />
          </div>
        </div>
        {errorKey ? <StatusMessage message={t(errorKey)} tone="error" /> : null}
      </PanelSection>
    </div>
  );
}
