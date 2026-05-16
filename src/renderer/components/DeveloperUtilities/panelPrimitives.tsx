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
import { useClipboardOnFocus } from '../../hooks/useClipboardOnFocus';
import {
  useUtilityHistoryStore,
  type UtilityHistoryEntry,
} from '../../stores/utilityHistoryStore';
import { useUtilityOutputStore } from '../../stores/utilityOutputStore';
import { UtilityHistoryDrawer } from './UtilityHistoryDrawer';

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
    <section className="um-card grid gap-4">
      <div className="grid gap-1">
        <h3 className="um-card-title">{title}</h3>
        <p className="um-card-subtitle">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="font-mono text-[10.5px] font-bold uppercase text-fg-subtle">{children}</label>;
}

export function UtilityTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`um-control ${
        props.className ?? ''
      }`}
    />
  );
}

export function UtilityInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`um-control ${
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
  setPrimary,
  applyTestId = 'utility-apply-button',
  className,
  children,
}: {
  utilityId: DeveloperUtilityId;
  primary: string;
  secondary?: string;
  run: () => void;
  /**
   * RL-069 Slice 3 — when provided, the toolbar renders the
   * `<UtilityHistoryDrawer>` and routes drawer entry clicks back to
   * the panel via this setter. Pure-generator panels and panels with
   * exotic input shapes (Hash file, Random String options) can omit
   * this prop and the drawer is silently skipped — the existing copy
   * shortcuts still work.
   */
  setPrimary?: (value: string) => void;
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
    // RL-069 Slice 3 — fold the apply event into the per-tool history
    // ring. The output snapshot is read from the registered output
    // provider so we capture exactly what Cmd+Shift+C would copy at
    // this moment, with no extra plumbing per panel.
    const provider = useUtilityOutputStore.getState().getProvider();
    const output = provider?.() ?? '';
    useUtilityHistoryStore.getState().pushEntry(utilityId, primary, output);
  }, [detect, enabled, run, utilityId, primary]);

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
        // Mirror handleApply's history emission so Mod+Shift+A also
        // accumulates entries — keyboard users get the same drawer
        // populated as click users.
        const provider = useUtilityOutputStore.getState().getProvider();
        const output = provider?.() ?? '';
        useUtilityHistoryStore.getState().pushEntry(utilityId, primary, output);
      },
    }),
    [definition.titleKey, detect, enabled, run, utilityId, primary]
  );
  useRegisterUtilityApply(applyHandler);

  const handleHistoryEntry = useCallback(
    (entry: UtilityHistoryEntry) => {
      if (setPrimary) setPrimary(entry.input);
    },
    [setPrimary]
  );

  // RL-069 Slice 3 — when the user has granted clipboard-on-focus
  // consent, fire the read once on panel mount. The hook short-
  // circuits when consent is unset/declined or when setPrimary is
  // missing (panels with exotic input shapes opt out by not passing
  // setPrimary). The detect callback narrows the catalog's predicate
  // to the panel-level shape with empty secondary so the hook
  // matches the same surface the toolbar already governs.
  const clipboardDetect = useCallback(
    (clipboardValue: string) => {
      if (!setPrimary || !detect) return false;
      try {
        return detect({ primary: clipboardValue });
      } catch {
        return false;
      }
    },
    [detect, setPrimary]
  );
  const applyClipboardValue = useCallback(
    (value: string) => {
      if (setPrimary) setPrimary(value);
    },
    [setPrimary]
  );
  useClipboardOnFocus(utilityId, clipboardDetect, applyClipboardValue, {
    enabled: Boolean(setPrimary),
  });

  if (!detect) {
    // Generator panel — no Apply button, but still allow extras. This
    // keeps the toolbar API uniform across the catalog.
    if (!children) return null;
    return (
      <div
        data-testid="utility-toolbar"
        className={`um-toolbar flex flex-wrap items-center gap-2 ${className ?? ''}`}
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
      className={`um-toolbar grid gap-2 ${className ?? ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={!enabled}
          data-testid={applyTestId}
          aria-label={t(labelKey)}
          title={t(tooltipKey)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-bg-panel px-3 py-1.5 text-xs font-semibold text-fg-base transition-colors hover:bg-bg-panel-alt disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Zap size={12} aria-hidden="true" />
          {t(labelKey)}
        </button>
        {children}
      </div>
      {setPrimary ? (
        <UtilityHistoryDrawer utilityId={utilityId} onApplyEntry={handleHistoryEntry} />
      ) : null}
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
