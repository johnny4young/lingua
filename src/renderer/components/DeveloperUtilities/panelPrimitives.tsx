import type React from 'react';
import { useCallback, useId, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from './CopyButton';
import { findDeveloperUtility, type DeveloperUtilityId } from '../../data/developerUtilities';
import { useRegisterUtilityApply } from '../../hooks/useRegisterUtilityOutput';
import { useClipboardOnFocus } from '../../hooks/useClipboardOnFocus';
import { useUtilityPanelActive } from '../../hooks/utilityPanelActive';
import { useUtilityHistoryStore, type UtilityHistoryEntry } from '../../stores/utilityHistoryStore';
import { useUtilityOutputStore } from '../../stores/utilityOutputStore';
import { cn } from '../../utils/cn';
import type { TimestampHoverInfo } from '../../utils/developerUtilities';
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
  return (
    <label className="font-mono text-eyebrow font-bold uppercase text-fg-subtle">{children}</label>
  );
}

export function UtilityTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`um-control ${props.className ?? ''}`} />;
}

export function UtilityInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`um-control ${props.className ?? ''}`} />;
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
    <p className={`text-body-sm leading-5 ${toneClass} ${className ?? ''}`} data-testid={testid}>
      {message}
    </p>
  );
}

export const UTILITY_BALANCED_PANE_GRID =
  'grid gap-4 xl:grid-cols-[minmax(18rem,1fr)_minmax(18rem,1fr)]';

export const UTILITY_OUTPUT_WIDE_PANE_GRID =
  'grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(28rem,1.25fr)] 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(34rem,1.45fr)]';

export const UTILITY_OUTPUT_MAX_PANE_GRID =
  'grid gap-4 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(32rem,1.45fr)] 2xl:grid-cols-[minmax(20rem,0.65fr)_minmax(42rem,1.7fr)]';

export const UTILITY_TALL_TEXTAREA_CLASS = 'min-h-[16rem] font-mono';

export const UTILITY_EXTRA_TALL_TEXTAREA_CLASS = 'min-h-[20rem] font-mono';

export function TimestampHoverValue({
  value,
  timestamp,
}: {
  value: string;
  timestamp: TimestampHoverInfo;
}) {
  const { t } = useTranslation();
  const reactId = useId();
  const tooltipId = `utility-timestamp-${reactId.replace(/:/g, '')}`;

  return (
    <span className="group relative inline-flex align-baseline">
      <span
        tabIndex={0}
        aria-describedby={tooltipId}
        data-testid="json-timestamp-value"
        className="focus-ring inline-flex cursor-help items-center rounded-md border border-accent/25 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.82em] font-semibold text-accent-fg transition-colors hover:border-accent/45 hover:bg-accent/15"
      >
        {value}
      </span>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute left-0 top-[calc(100%+0.45rem)] z-50 hidden w-max max-w-[20rem] rounded-xl border border-border-subtle bg-bg-panel px-3 py-2 text-left text-caption leading-5 text-fg-base shadow-xl group-hover:block group-focus-within:block"
      >
        <span className="block font-mono text-[0.68rem] font-bold uppercase tracking-[0.18em] text-fg-subtle">
          {t('utilities.timestampHover.local')}
        </span>
        <span className="block whitespace-nowrap">{timestamp.local}</span>
        <span className="mt-1.5 block font-mono text-[0.68rem] font-bold uppercase tracking-[0.18em] text-fg-subtle">
          {t('utilities.timestampHover.utc')}
        </span>
        <span className="block whitespace-nowrap">{timestamp.utc}</span>
        <span className="mt-1.5 block font-mono text-[0.68rem] text-fg-muted">{timestamp.iso}</span>
      </span>
    </span>
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
  leading,
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
  /**
   * Space audit — panel-specific controls (e.g. the JWT mode select)
   * rendered BEFORE the Apply button so they share the toolbar's single
   * row instead of stacking a row of their own above it.
   */
  leading?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const panelActive = useUtilityPanelActive();
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
    enabled: Boolean(setPrimary) && panelActive,
  });

  if (!detect) {
    // Generator panel — no Apply button, but still allow extras. This
    // keeps the toolbar API uniform across the catalog.
    if (!children && !leading) return null;
    return (
      <div
        data-testid="utility-toolbar"
        className={`um-toolbar flex flex-wrap items-center gap-2 ${className ?? ''}`}
      >
        {leading}
        {children}
      </div>
    );
  }

  const labelKey = 'utilities.actions.applyFromInput';
  const tooltipKey = enabled
    ? 'utilities.actions.applyFromInput'
    : 'utilities.tooltip.applyUnavailable';
  return (
    // Space audit — ONE wrapping row: leading extras, Apply, children,
    // and the Recent-runs drawer side by side (the drawer flexes into
    // the remaining width; its expanded list drops below within it).
    <div
      data-testid="utility-toolbar"
      className={`um-toolbar flex flex-wrap items-center gap-2 ${className ?? ''}`}
    >
      {leading}
      <button
        type="button"
        onClick={handleApply}
        disabled={!enabled}
        data-testid={applyTestId}
        aria-label={t(labelKey)}
        title={t(tooltipKey)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-bg-panel px-3 py-1.5 text-body-sm font-semibold text-fg-base transition-colors hover:bg-bg-panel-alt disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Zap size={12} aria-hidden="true" />
        {t(labelKey)}
      </button>
      {children}
      {setPrimary ? (
        <div className="min-w-[14rem] flex-1">
          <UtilityHistoryDrawer utilityId={utilityId} onApplyEntry={handleHistoryEntry} />
        </div>
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
  layout = 'balanced',
  inputClassName,
  outputClassName,
}: {
  title: string;
  description: string;
  input: string;
  onInputChange: (value: string) => void;
  output: string;
  errorKey: string | null;
  layout?: 'balanced' | 'output-wide' | 'output-max';
  inputClassName?: string;
  outputClassName?: string;
}) {
  const { t } = useTranslation();
  const gridClassName =
    layout === 'output-max'
      ? UTILITY_OUTPUT_MAX_PANE_GRID
      : layout === 'output-wide'
        ? UTILITY_OUTPUT_WIDE_PANE_GRID
        : UTILITY_BALANCED_PANE_GRID;
  return (
    <div className={gridClassName}>
      <PanelSection title={title} description={description}>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.input')}
            value={input}
            onChange={event => onInputChange(event.target.value)}
            className={inputClassName}
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
            className={cn('pr-10', outputClassName, errorKey ? 'text-danger' : undefined)}
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
