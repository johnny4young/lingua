import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGE_CAPABILITIES,
  LANGUAGE_CAPABILITY_STATUSES,
  LANGUAGE_SUPPORT_PROFILES,
  type LanguageCapability,
  type LanguageCapabilityStatus,
  type LanguageSupportProfile,
} from '../../../shared/languageSupport';
import { trackEvent } from '../../utils/telemetry';
import { SettingsSection } from '../ui/SpecRow';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';
import {
  clearLanguageScorecardSurfaceClaim,
  hasLanguageScorecardSurfaceFired,
  markLanguageScorecardSurfaceFired,
  readLanguageScorecardSurfaceForMount,
  type LanguageScorecardSurface,
} from './languageSupportScorecardTelemetry';

/**
 * RL-095 Slice 1 — Language Support Scorecard.
 *
 * Renders `LANGUAGE_SUPPORT_PROFILES` as a table inside Settings →
 * Languages. The table is the user-facing
 * companion to `docs/CAPABILITY_MATRIX.md` — both are derived from
 * the same shared array, so docs and UI stay in lockstep (a guard
 * test in `tests/docs/capabilityMatrixDrift.test.ts` enforces this
 * at CI time).
 *
 * Design choices:
 *   - **Table-style render** with one row per language + 9 columns
 *     for the closed `LanguageCapability` enum. Status chips reuse the
 *     shared `<StatusBadge>` so the matrix speaks the same status
 *     family as license / run / unsaved signals elsewhere: the user
 *     scans vertically (which languages are fully supported) and
 *     horizontally (where a language is weak).
 *   - **Fold C — per-platform chips**: capabilities with
 *     `perPlatform` overrides render two small W / D `<StatusBadge>`
 *     pills inside the cell, each carrying its own status tone. The
 *     default `capabilities` value still drives the primary cell badge
 *     so the at-a-glance read stays simple.
 *   - **Fold D — status legend popover**: a "?" button in the
 *     header opens a popover with the definition of each
 *     `LanguageCapabilityStatus` so first-time readers don't have
 *     to guess what "partial" vs "desktop-only" mean.
 *   - **Fold A — adoption telemetry**: `language_scorecard_viewed`
 *     fires once per session when the scorecard enters the viewport,
 *     tagged `surface: 'settings'` (the palette path tags
 *     `'palette'` independently). The palette callback claims the
 *     next mount via `markLanguageScorecardSurfaceForNextMount('palette')`
 *     so the IntersectionObserver fires the event exactly once with
 *     the right tag — no double-fire from a parallel `trackEvent`
 *     call. The property is named `surface` (not `source`) because
 *     the telemetry redactor strips any key whose lowercased name
 *     contains 'source'.
 */

/**
 * Maps each `LanguageCapabilityStatus` onto a shared `<StatusBadge>`
 * tone so the scorecard, its legend, and the per-platform pills all
 * speak the system status family (no bespoke chip styling):
 *   available  → success   partial      → warning
 *   desktop-only/web-only → info        planned   → neutral
 *   unsupported → error
 */
const STATUS_TONE: Record<LanguageCapabilityStatus, StatusBadgeTone> = {
  available: 'success',
  partial: 'warning',
  'desktop-only': 'info',
  'web-only': 'info',
  planned: 'neutral',
  unsupported: 'error',
};

export interface LanguageSupportScorecardProps {
  /**
   * Override the surface tag for the adoption telemetry event.
   * Defaults to `'settings'`. Out-of-band callers (palette command)
   * use `markLanguageScorecardSurfaceForNextMount` instead so the
   * single mount the page actually owns picks up the right value.
   */
  surface?: LanguageScorecardSurface;
}

export function LanguageSupportScorecard({
  surface: surfaceProp = 'settings',
}: LanguageSupportScorecardProps = {}) {
  const { t } = useTranslation();
  const [legendOpen, setLegendOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Read the override at mount via `useState` init (pure read; both
  // StrictMode invocations of the init return the same value because
  // the consume below runs in an effect, not during render). Mutating
  // module-level state during render trips React 19's
  // `react-hooks/globals` rule, so the null-out lives in the effect.
  const [surface] = useState<LanguageScorecardSurface>(
    () => readLanguageScorecardSurfaceForMount(surfaceProp)
  );
  // Consume the claim exactly once per mount. Putting the assignment
  // in an effect keeps the render body pure; StrictMode's double-
  // invoke effect-cycle in dev still ends with a null override.
  useEffect(() => {
    clearLanguageScorecardSurfaceClaim();
  }, []);

  // Fold A — fire `language_scorecard_viewed` once per session per
  // surface when the scorecard enters the viewport. Falls back to
  // an immediate fire when IntersectionObserver is unavailable
  // (older Electron, jsdom).
  useEffect(() => {
    if (hasLanguageScorecardSurfaceFired(surface)) return;
    if (typeof IntersectionObserver === 'undefined') {
      markLanguageScorecardSurfaceFired(surface);
      void trackEvent('language_scorecard_viewed', { surface });
      return;
    }
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasLanguageScorecardSurfaceFired(surface)) {
            markLanguageScorecardSurfaceFired(surface);
            void trackEvent('language_scorecard_viewed', { surface });
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [surface]);

  return (
    <SettingsSection
      eyebrow={t('languageSupport.scorecard.title')}
      description={t('languageSupport.scorecard.description')}
    >
      <div
        ref={containerRef}
        className="rounded-lg border border-border-subtle bg-bg-inset"
        data-testid="language-support-scorecard"
        data-surface={surface}
      >
        <div className="flex items-center justify-between gap-3 px-[18px] py-3">
          <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">
            {t('languageSupport.scorecard.tableLabel')}
          </span>
          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            data-testid="language-support-scorecard-legend-toggle"
            aria-expanded={legendOpen}
            className="rounded-sm border border-border-subtle px-2 py-0.5 font-mono text-eyebrow text-fg-muted hover:bg-bg-panel-alt"
            title={t('languageSupport.scorecard.legendButton')}
            aria-label={t('languageSupport.scorecard.legendButton')}
          >
            ?
          </button>
        </div>
        {legendOpen ? (
          <ul
            data-testid="language-support-scorecard-legend"
            className="mx-[18px] mb-3 grid gap-1.5 rounded-md border border-border-subtle bg-bg-panel-alt px-3 py-2 text-caption text-fg-subtle sm:grid-cols-2"
          >
            {LANGUAGE_CAPABILITY_STATUSES.map((status) => (
              <li
                key={status}
                className="flex items-start gap-2"
                data-status={status}
              >
                <StatusBadge tone={STATUS_TONE[status]}>
                  {t(`languageSupport.status.${statusKeyFragment(status)}`)}
                </StatusBadge>
                <span className="leading-snug">
                  {t(`languageSupport.statusDescription.${statusKeyFragment(status)}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {/*
         * RL-095 / FASE 2a — horizontal scroll wrapper. The cell badges
         * never wrap, so the 9-column table is wider than the panel. A
         * fixed `min-w-[720px]` (matches the mockup's `minWidth: 720`)
         * forces every column — including the rightmost DEBUG axis,
         * which previously clipped — to lay out at full width; the
         * `overflow-auto` parent then scrolls the whole table sideways
         * instead of squeezing the last column to nothing.
         */}
        <div className="overflow-auto px-[18px] pb-3">
          <table className="min-w-[720px] border-collapse text-caption">
            <thead>
              <tr className="text-left text-fg-subtle">
                <th className="px-2 py-1 font-mono text-micro font-semibold uppercase tracking-[0.1em]">
                  {t('languageSupport.scorecard.languageColumn')}
                </th>
                {LANGUAGE_CAPABILITIES.map((cap) => (
                  <th
                    key={cap}
                    scope="col"
                    className="whitespace-nowrap px-2 py-1 font-mono text-micro font-semibold uppercase tracking-[0.08em]"
                    title={t(`languageSupport.capability.${cap}`)}
                  >
                    {t(`languageSupport.capability.${cap}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LANGUAGE_SUPPORT_PROFILES.map((profile) => (
                <tr
                  key={profile.languageId}
                  className="border-t border-border-subtle"
                  data-testid={`language-support-scorecard-row-${profile.languageId}`}
                >
                  <th
                    scope="row"
                    className="whitespace-nowrap px-2 py-2 text-left text-body-sm font-medium text-fg-base"
                  >
                    {profile.displayName}
                  </th>
                  {LANGUAGE_CAPABILITIES.map((cap) => (
                    <ScorecardCell key={cap} capability={cap} profile={profile} t={t} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SettingsSection>
  );
}

interface ScorecardCellProps {
  capability: LanguageCapability;
  profile: LanguageSupportProfile;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ScorecardCell({ capability, profile, t }: ScorecardCellProps) {
  const status = profile.capabilities[capability];
  const note = profile.notes?.[capability];
  const platform = profile.perPlatform?.[capability];
  const hasPlatformOverride =
    platform !== undefined &&
    (platform.web !== undefined || platform.desktop !== undefined);

  const cellTitle = note ?? t(`languageSupport.status.${statusKeyFragment(status)}`);
  const webTitle = platform?.web
    ? t('languageSupport.platform.webTitle', {
        status: t(`languageSupport.status.${statusKeyFragment(platform.web)}`),
      })
    : undefined;
  const desktopTitle = platform?.desktop
    ? t('languageSupport.platform.desktopTitle', {
        status: t(`languageSupport.status.${statusKeyFragment(platform.desktop)}`),
      })
    : undefined;

  return (
    <td
      className="px-2 py-2 align-top"
      data-testid={`language-support-scorecard-cell-${profile.languageId}-${capability}`}
      data-status={status}
      title={cellTitle}
    >
      <div className="flex flex-col items-start gap-1">
        <StatusBadge tone={STATUS_TONE[status]}>
          {t(`languageSupport.status.${statusKeyFragment(status)}`)}
        </StatusBadge>
        {hasPlatformOverride ? (
          <span
            className="flex gap-1"
            data-testid={`language-support-scorecard-platform-${profile.languageId}-${capability}`}
          >
            {platform!.web !== undefined ? (
              <span data-platform="web" title={webTitle} aria-label={webTitle}>
                <StatusBadge tone={STATUS_TONE[platform!.web]}>
                  {t('languageSupport.platform.webShort')}
                </StatusBadge>
              </span>
            ) : null}
            {platform!.desktop !== undefined ? (
              <span data-platform="desktop" title={desktopTitle} aria-label={desktopTitle}>
                <StatusBadge tone={STATUS_TONE[platform!.desktop]}>
                  {t('languageSupport.platform.desktopShort')}
                </StatusBadge>
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </td>
  );
}

/**
 * Status enum values include kebab-case (e.g. `'desktop-only'`); i18n
 * keys conventionally use camelCase. Map once here so the renderer
 * doesn't have to pepper conditionals.
 */
function statusKeyFragment(status: LanguageCapabilityStatus): string {
  switch (status) {
    case 'available':
      return 'available';
    case 'partial':
      return 'partial';
    case 'desktop-only':
      return 'desktopOnly';
    case 'web-only':
      return 'webOnly';
    case 'planned':
      return 'planned';
    case 'unsupported':
      return 'unsupported';
  }
}
