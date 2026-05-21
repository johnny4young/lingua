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
import { Section } from './shared';
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
 *     for the closed `LanguageCapability` enum. Status chips are
 *     color-coded so the user can scan vertically (which languages
 *     are fully supported) and horizontally (where a language is
 *     weak).
 *   - **Fold C — per-platform chips**: capabilities with
 *     `perPlatform` overrides render two small W / D pills inside
 *     the cell, each carrying its own status. The default `capabilities`
 *     value still drives the cell color so the at-a-glance read
 *     stays simple.
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

const STATUS_TONE: Record<LanguageCapabilityStatus, string> = {
  available: 'border-success-border/55 bg-success-bg/70 text-success-fg',
  partial: 'border-warning-border/55 bg-warning-bg/70 text-warning-fg',
  'desktop-only': 'border-info-border/55 bg-info-bg/70 text-info-fg',
  'web-only': 'border-accent/40 bg-primary-soft/70 text-accent-fg',
  planned: 'border-border/40 bg-bg-elevated/60 text-fg-muted',
  unsupported: 'border-error-border/55 bg-error-bg/70 text-error-fg',
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
    <Section
      title={t('languageSupport.scorecard.title')}
      description={t('languageSupport.scorecard.description')}
    >
      <div
        ref={containerRef}
        className="overflow-x-auto rounded-[1.15rem] border border-border/80 bg-background-elevated/72 p-3"
        data-testid="language-support-scorecard"
        data-surface={surface}
      >
        <div className="flex items-center justify-between gap-3 pb-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-fg-subtle">
            {t('languageSupport.scorecard.tableLabel')}
          </span>
          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            data-testid="language-support-scorecard-legend-toggle"
            aria-expanded={legendOpen}
            className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-mono text-fg-muted hover:bg-bg-elevated"
            title={t('languageSupport.scorecard.legendButton')}
            aria-label={t('languageSupport.scorecard.legendButton')}
          >
            ?
          </button>
        </div>
        {legendOpen ? (
          <ul
            data-testid="language-support-scorecard-legend"
            className="mb-3 grid gap-1.5 rounded-md border border-border/60 bg-bg-elevated/80 p-2 text-[11px] text-fg-muted sm:grid-cols-2"
          >
            {LANGUAGE_CAPABILITY_STATUSES.map((status) => (
              <li
                key={status}
                className="flex items-start gap-2"
                data-status={status}
              >
                <span
                  className={`mt-0.5 inline-flex shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] ${STATUS_TONE[status]}`}
                >
                  {t(`languageSupport.status.${statusKeyFragment(status)}`)}
                </span>
                <span className="leading-snug">
                  {t(`languageSupport.statusDescription.${statusKeyFragment(status)}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-fg-subtle">
              <th className="px-2 py-1 font-semibold uppercase tracking-[0.12em]">
                {t('languageSupport.scorecard.languageColumn')}
              </th>
              {LANGUAGE_CAPABILITIES.map((cap) => (
                <th
                  key={cap}
                  scope="col"
                  className="px-2 py-1 font-semibold uppercase tracking-[0.12em]"
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
                className="border-t border-border/40"
                data-testid={`language-support-scorecard-row-${profile.languageId}`}
              >
                <th
                  scope="row"
                  className="px-2 py-2 text-left font-medium text-fg-base"
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
    </Section>
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
      <div className="flex flex-col gap-1">
        <span
          className={`inline-flex w-fit rounded-full border px-2 py-0.5 font-mono text-[10px] ${STATUS_TONE[status]}`}
        >
          {t(`languageSupport.status.${statusKeyFragment(status)}`)}
        </span>
        {hasPlatformOverride ? (
          <span
            className="flex gap-1 text-[9px] text-fg-subtle"
            data-testid={`language-support-scorecard-platform-${profile.languageId}-${capability}`}
          >
            {platform!.web !== undefined ? (
              <span
                data-platform="web"
                className={`rounded-sm border px-1 py-0 font-mono ${STATUS_TONE[platform!.web]}`}
                title={webTitle}
                aria-label={webTitle}
              >
                {t('languageSupport.platform.webShort')}
              </span>
            ) : null}
            {platform!.desktop !== undefined ? (
              <span
                data-platform="desktop"
                className={`rounded-sm border px-1 py-0 font-mono ${STATUS_TONE[platform!.desktop]}`}
                title={desktopTitle}
                aria-label={desktopTitle}
              >
                {t('languageSupport.platform.desktopShort')}
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
