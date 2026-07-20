import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { applyRedactionPreview, type RedactionPreviewResult } from '../../utils/redactionPreview';
import { useSettingsStore } from '../../stores/settingsStore';
import { useLicenseStore } from '../../stores/licenseStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useDependencyDetectionStore } from '../../stores/dependencyDetectionStore';
import { TRUST_EVENT_STORAGE_KEY, useTrustEventStore } from '../../stores/trustEventStore';
import { useUIStore } from '../../stores/uiStore';
import { OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { SettingsSection } from '../ui/SpecRow';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';
import { trackEvent } from '../../utils/telemetry';
import {
  clearPrivacyDashboardSurfaceClaim,
  hasPrivacyDashboardSurfaceFired,
  markPrivacyDashboardSurfaceFired,
  readPrivacyDashboardSurfaceForMount,
  type PrivacyDashboardSurface,
} from './privacyTrustTelemetry';
import {
  buildNetworkActivityRows,
  formatBytes,
  formatRelativeTimestamp,
  getLocalStoreRows,
  latestEventAtByFeature,
  type LinguaLocalStoreKey,
  type NetworkActivityFeature,
  type NetworkActivityStatus,
} from './privacyTrustHelpers';
import type { TrustEvent, TrustFeature, TrustSensitivity } from '../../stores/trustEventStore';
import { emitCommand } from '../../stores/commandBus';
import type { TabId } from './settingsRailModel';

/** implementation — newest N trust events shown in the Recent activity feed. */
const RECENT_ACTIVITY_LIMIT = 8;

/** implementation note — sensitivity filter options (render order). */
const SENSITIVITY_FILTER_OPTIONS = ['all', 'low', 'medium', 'high'] as const;

/** implementation — sensitivity → StatusBadge tone for the feed chips. */
const SENSITIVITY_TONE: Record<TrustSensitivity, StatusBadgeTone> = {
  low: 'neutral',
  medium: 'warning',
  high: 'error',
};

/**
 * implementation note — Network rows deep-link to the Settings tab that
 * owns the matching control. Only features with a real destination appear
 * here; the rest render as plain text. Tab ids mirror `RAIL_ITEMS` in
 * `SettingsModal` (telemetry consent + license live under Account; the
 * update check under General; dependency detection under Editor).
 */
const FEATURE_SETTINGS_TAB: Partial<Record<NetworkActivityFeature, TabId>> = {
  telemetry: 'account',
  updates: 'general',
  license: 'account',
  dependencies: 'editor',
};

function navigateToSettingsTab(tab: TabId): void {
  emitCommand('settings.navigate', { tab });
}

/**
 * i18n key for a trust feature's display label in the Recent activity feed.
 * Trust features (which include `share-link`) are a superset of the Network
 * table features, so this is a dedicated map rather than a reuse of
 * `networkFeatureLabel`.
 */
function trustFeatureLabel(feature: TrustFeature): string {
  return `settings.privacy.recent.feature.${feature}`;
}

/**
 * i18n key for a captured action verb. Known actions get a localized label;
 * an unrecognized action falls back to its raw (closed-enum) string via the
 * caller's `defaultValue`.
 */
function trustActionLabel(action: string): string {
  return `settings.privacy.recent.action.${action}`;
}

/**
 * implementation — Privacy + Trust Dashboard root component.
 *
 * Mounted as the `'privacy'` tab in `<SettingsModal>`. Three
 * stacked sub-sections:
 *
 *   1. Redaction preview — paste-anything textarea showing what the
 *      shared redaction primitives from `src/shared/redaction.ts` would
 *      strip. Same helper that capsule export + share link use, so
 *      the preview cannot drift from the real export.
 *   2. Local stores audit — table of the localStorage keys
 *      Lingua owns, with byte size estimates and per-row Clear
 *      action (gated by a confirmation modal — implementation note).
 *   3. Network activity summary — one-line status per feature that
 *      may send data off the device.
 *
 * The dashboard reads from existing stores (no new IPC, no new
 * persistent state) so it stays as a passive audit surface. The
 * only mutation is the Clear button per row, which calls
 * `window.localStorage.removeItem` directly.
 */
export function PrivacyTrustSection() {
  const { t } = useTranslation();
  const telemetryConsent = useSettingsStore(s => s.telemetryConsent);
  const licenseToken = useLicenseStore(s => s.token);
  const clearLicense = useLicenseStore(s => s.clearLicense);
  const pushStatusNotice = useUIStore(s => s.pushStatusNotice);
  // implementation — reach into the dependency install state to
  // surface the most recent install timestamp in the network
  // activity table. We take the max across every tab so the row
  // reflects "any install in this session", not just the active tab.
  // implementation note — count of run capsules retained in memory.
  // Derive a primitive (not the `capsuleEntries()` array) so the
  // subscription stays stable and never trips zustand v5's update loop.
  const capsulesRetained = useExecutionHistoryStore(
    s => s.entries.filter(entry => entry.lastCapsule !== undefined).length
  );
  const dependencyInstallLastAt = useDependencyDetectionStore(s => {
    let latest: number | null = null;
    for (const entry of s.installByTab.values()) {
      if (entry.lastAttemptAt !== null) {
        if (latest === null || entry.lastAttemptAt > latest) {
          latest = entry.lastAttemptAt;
        }
      }
    }
    return latest;
  });

  // implementation — the live trust-event log drives both the Network
  // table's real "last call" timestamps and the Recent activity feed.
  const trustEvents = useTrustEventStore(s => s.events);
  // implementation note — Recent-activity sensitivity filter. `all`
  // shows every captured event; the others narrow to one severity.
  const [sensitivityFilter, setSensitivityFilter] = useState<'all' | TrustSensitivity>('all');

  // Refresh trigger — bumped after every Clear so the size estimates
  // re-read localStorage. Cheap because the audited key list is tiny.
  const [, setRefreshTick] = useState(0);
  const [confirmKey, setConfirmKey] = useState<LinguaLocalStoreKey | null>(null);
  const [pasteInput, setPasteInput] = useState('');
  const [surface] = useState<PrivacyDashboardSurface>(() =>
    readPrivacyDashboardSurfaceForMount('settings')
  );

  useEffect(() => {
    clearPrivacyDashboardSurfaceClaim();
  }, []);

  useEffect(() => {
    if (hasPrivacyDashboardSurfaceFired(surface)) return;
    markPrivacyDashboardSurfaceFired(surface);
    void trackEvent('privacy.dashboard_opened', { surface });
  }, [surface]);

  const localRows = getLocalStoreRows();

  const networkRows = useMemo(() => {
    // implementation — derive the per-feature "last call" from the live
    // trust log instead of the implementation hardcoded nulls.
    const lastAt = latestEventAtByFeature(trustEvents);
    return buildNetworkActivityRows({
      telemetryConsent,
      licenseStatus: deriveLicenseStatus(licenseToken),
      capsuleExportLastAt: lastAt['capsule-export'] ?? null,
      telemetryLastAt: lastAt.telemetry ?? null,
      updateCheckLastAt: lastAt.updates ?? null,
      licenseVerifyLastAt: lastAt.license ?? null,
      dependencyInstallLastAt,
    });
  }, [telemetryConsent, licenseToken, dependencyInstallLastAt, trustEvents]);

  // implementation — newest-initial implementation of the trust log for the Recent
  // activity feed, narrowed by the implementation note sensitivity filter.
  const recentEvents = useMemo(() => {
    const filtered =
      sensitivityFilter === 'all'
        ? trustEvents
        : trustEvents.filter(event => event.sensitivity === sensitivityFilter);
    return [...filtered].reverse().slice(0, RECENT_ACTIVITY_LIMIT);
  }, [trustEvents, sensitivityFilter]);

  const previewResult: RedactionPreviewResult = useMemo(() => {
    return applyRedactionPreview(pasteInput);
  }, [pasteInput]);

  const handleClear = (key: LinguaLocalStoreKey) => {
    try {
      if (key === 'lingua-license') {
        void clearLicense();
      }
      if (key === TRUST_EVENT_STORAGE_KEY) {
        useTrustEventStore.getState().clear();
      }
      window.localStorage.removeItem(key);
    } catch {
      // Quota / private-mode errors are silent — the row size will
      // simply not change.
    }
    pushStatusNotice({
      tone: 'success',
      messageKey: 'settings.privacy.localStores.cleared',
      values: { key },
    });
    setConfirmKey(null);
    setRefreshTick(tick => tick + 1);
  };

  return (
    <div className="space-y-7" data-testid="privacy-trust-section" data-surface={surface}>
      <SettingsSection
        eyebrow={t('settings.privacy.title')}
        description={t('settings.privacy.hint')}
      >
        {/* Redaction preview */}
        <RedactionPreviewBlock input={pasteInput} result={previewResult} onChange={setPasteInput} />
      </SettingsSection>

      <SettingsSection
        eyebrow={t('settings.privacy.localStores.title')}
        description={t('settings.privacy.localStores.hint')}
      >
        <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-inset">
          <table className="min-w-full text-body" data-testid="privacy-local-stores-table">
            <thead className="bg-bg-panel-alt text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-subtle">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  {t('settings.privacy.localStores.col.key')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('settings.privacy.localStores.col.purpose')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('settings.privacy.localStores.col.size')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('settings.privacy.localStores.col.clear')}
                </th>
              </tr>
            </thead>
            <tbody>
              {localRows.map(row => (
                <tr
                  key={row.key}
                  className="border-t border-border-subtle"
                  data-testid={`privacy-local-stores-row-${row.key}`}
                >
                  <td className="px-3 py-2 font-mono text-body-sm text-fg-base">{row.key}</td>
                  <td className="px-3 py-2 text-body-sm text-fg-muted">{t(row.purposeKey)}</td>
                  <td
                    className="px-3 py-2 text-right font-mono text-body-sm text-fg-muted"
                    data-testid={`privacy-local-stores-size-${row.key}`}
                  >
                    {formatBytes(row.bytes)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setConfirmKey(row.key)}
                      disabled={row.bytes === 0}
                      className="inline-flex items-center justify-center rounded-md p-1 text-fg-muted transition-colors hover:bg-error/10 hover:text-error disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
                      data-testid={`privacy-local-stores-clear-${row.key}`}
                      aria-label={t('settings.privacy.localStores.col.clear')}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/*
         * implementation note — run capsules live in the in-memory
         * execution-history ring, NOT in localStorage, so they are
         * called out separately from the audit table above. The count
         * makes the Pro-gated capsule browse retention transparent;
         * the copy is explicit that a reload clears them.
         */}
        <p data-testid="privacy-capsules-retained" className="text-body-sm text-fg-subtle">
          {t('settings.privacy.localStores.capsulesRetained', {
            count: capsulesRetained,
          })}
        </p>
      </SettingsSection>

      <SettingsSection
        eyebrow={t('settings.privacy.network.title')}
        description={t('settings.privacy.network.hint')}
      >
        <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-inset">
          <table className="min-w-full text-body" data-testid="privacy-network-activity-table">
            <thead className="bg-bg-panel-alt text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-subtle">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  {t('settings.privacy.network.col.feature')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('settings.privacy.network.col.status')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('settings.privacy.network.col.lastCall')}
                </th>
              </tr>
            </thead>
            <tbody>
              {networkRows.map(row => (
                <tr
                  key={row.feature}
                  className="border-t border-border-subtle"
                  data-testid={`privacy-network-row-${row.feature}`}
                >
                  <td className="px-3 py-2 text-body-sm text-fg-base">
                    {FEATURE_SETTINGS_TAB[row.feature] ? (
                      <button
                        type="button"
                        onClick={() => navigateToSettingsTab(FEATURE_SETTINGS_TAB[row.feature]!)}
                        data-testid={`privacy-network-deeplink-${row.feature}`}
                        className="text-left text-accent transition-colors hover:underline"
                      >
                        {t(networkFeatureLabel(row.feature))}
                      </button>
                    ) : (
                      t(networkFeatureLabel(row.feature))
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <NetworkStatusChip status={row.status} />
                  </td>
                  <td className="px-3 py-2 text-body-sm text-fg-muted">
                    {row.lastCallAt === null
                      ? t('settings.privacy.network.lastCall.never')
                      : formatRelativeTimestamp(row.lastCallAt, undefined, t)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <SettingsSection
        eyebrow={t('settings.privacy.recent.title')}
        description={t('settings.privacy.recent.hint')}
      >
        {/* implementation note — narrow the feed by captured sensitivity. */}
        <div
          role="group"
          aria-label={t('settings.privacy.recent.filterLabel')}
          data-testid="privacy-recent-sensitivity-filter"
          className="mb-3 flex w-fit overflow-hidden rounded-sm border border-border-subtle"
        >
          {SENSITIVITY_FILTER_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setSensitivityFilter(option)}
              data-testid={`privacy-recent-filter-${option}`}
              aria-pressed={sensitivityFilter === option}
              className={
                'px-2 py-0.5 font-mono text-eyebrow ' +
                (sensitivityFilter === option
                  ? 'bg-bg-panel-alt text-fg-base'
                  : 'text-fg-muted hover:bg-bg-panel-alt')
              }
            >
              {t(`settings.privacy.recent.filter.${option}`)}
            </button>
          ))}
        </div>
        {recentEvents.length === 0 ? (
          <p
            data-testid="privacy-recent-empty"
            className="rounded-lg border border-border-subtle bg-bg-inset px-3 py-4 text-body-sm text-fg-muted"
          >
            {t('settings.privacy.recent.empty')}
          </p>
        ) : (
          <ul
            data-testid="privacy-recent-list"
            className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-bg-inset"
          >
            {recentEvents.map(event => (
              <RecentActivityRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </SettingsSection>

      {confirmKey ? (
        <ClearConfirmationModal
          storageKey={confirmKey}
          onConfirm={() => handleClear(confirmKey)}
          onCancel={() => setConfirmKey(null)}
        />
      ) : null}
    </div>
  );
}

function RedactionPreviewBlock({
  input,
  result,
  onChange,
}: {
  readonly input: string;
  readonly result: RedactionPreviewResult;
  readonly onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="privacy-redaction-preview">
      <h3 className="text-body font-medium leading-tight text-fg-base">
        {t('settings.privacy.redaction.title')}
      </h3>
      <textarea
        value={input}
        onChange={event => onChange(event.target.value)}
        placeholder={t('settings.privacy.redaction.placeholder')}
        rows={4}
        spellCheck={false}
        aria-label={t('settings.privacy.redaction.title')}
        className="w-full rounded-lg border border-border-subtle bg-bg-inset p-3 text-body font-mono text-fg-base outline-none transition-colors focus:border-accent/55"
        data-testid="privacy-redaction-input"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle bg-bg-inset p-3">
          <p className="mb-2 font-mono text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-subtle">
            {t('settings.privacy.redaction.before')}
          </p>
          <pre
            className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-caption leading-snug text-fg-base"
            data-testid="privacy-redaction-before"
          >
            {input.length === 0 ? t('settings.privacy.redaction.empty') : input}
          </pre>
        </div>
        <div className="rounded-lg border border-border-subtle bg-bg-inset p-3">
          <p className="mb-2 font-mono text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-subtle">
            {t('settings.privacy.redaction.after')}
          </p>
          <pre
            className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-caption leading-snug text-fg-base"
            data-testid="privacy-redaction-after"
          >
            {input.length === 0 ? t('settings.privacy.redaction.empty') : result.redacted}
          </pre>
        </div>
      </div>
    </div>
  );
}

/**
 * implementation — a single Recent-activity feed row. Renders the feature
 * label + localized action + sensitivity-toned badge + relative time, with
 * the (metadata-only) summary on its own line. The summary is rendered as a
 * dynamic value — it never carries code, field values, or a share URL by
 * construction at the capture sites.
 */
function RecentActivityRow({ event }: { readonly event: TrustEvent }) {
  const { t } = useTranslation();
  return (
    <li
      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
      data-testid={`privacy-recent-row-${event.id}`}
      data-feature={event.feature}
      data-sensitivity={event.sensitivity}
    >
      <span className="font-mono text-body-sm text-fg-base">
        {t(trustFeatureLabel(event.feature))}
      </span>
      <span className="text-body-sm text-fg-muted">
        {t(trustActionLabel(event.action), { defaultValue: event.action })}
      </span>
      <StatusBadge tone={SENSITIVITY_TONE[event.sensitivity]}>
        {t(`settings.privacy.recent.sensitivity.${event.sensitivity}`)}
      </StatusBadge>
      <span className="ml-auto font-mono text-caption text-fg-subtle">
        {formatRelativeTimestamp(event.at, undefined, t)}
      </span>
      <span className="w-full text-caption text-fg-muted">{event.summary}</span>
    </li>
  );
}

const NETWORK_STATUS_TONE: Record<NetworkActivityStatus, StatusBadgeTone> = {
  enabled: 'success',
  disabled: 'warning',
  unavailable: 'neutral',
};

function NetworkStatusChip({ status }: { status: NetworkActivityStatus }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex" data-testid={`privacy-network-status-${status}`}>
      <StatusBadge tone={NETWORK_STATUS_TONE[status]}>
        {t(`settings.privacy.network.status.${status}`)}
      </StatusBadge>
    </span>
  );
}

function ClearConfirmationModal({
  storageKey,
  onConfirm,
  onCancel,
}: {
  readonly storageKey: LinguaLocalStoreKey;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <OverlayBackdrop onClose={onCancel}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-clear-confirm-title"
        className="w-[min(92vw,520px)] max-w-none"
        data-testid="privacy-clear-confirm-modal"
      >
        <div className="surface-header px-5 py-4">
          <h2
            id="privacy-clear-confirm-title"
            className="font-display text-h2 font-semibold text-foreground"
          >
            {t('settings.privacy.localStores.clear.confirmTitle')}
          </h2>
        </div>
        <div className="px-5 py-5 text-body text-fg-muted">
          <p>
            {t('settings.privacy.localStores.clear.confirm', {
              key: storageKey,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/80 px-5 py-4">
          <button
            type="button"
            className="button-secondary"
            onClick={onCancel}
            data-testid="privacy-clear-confirm-cancel"
          >
            {t('settings.privacy.localStores.clear.cancel')}
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={onConfirm}
            data-testid="privacy-clear-confirm-confirm"
          >
            {t('settings.privacy.localStores.clear.confirmCta')}
          </button>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}

function deriveLicenseStatus(token: string | null): 'pro' | 'free' | 'invalid' | 'grace' {
  // Lingua's renderer cannot verify the token directly here; the
  // license store owns that. For dashboard purposes, presence of a
  // token => 'pro' (best-effort) and absence => 'free'. The status
  // is purely informational on this surface — the real source of
  // truth lives in `useLicenseStore`.
  return token ? 'pro' : 'free';
}

function networkFeatureLabel(feature: NetworkActivityFeature): string {
  return `settings.privacy.network.feature.${feature}`;
}
