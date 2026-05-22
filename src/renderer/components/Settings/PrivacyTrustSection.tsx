import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import {
  applyRedactionPreview,
  type RedactionPreviewResult,
} from '../../utils/redactionPreview';
import { useSettingsStore } from '../../stores/settingsStore';
import { useLicenseStore } from '../../stores/licenseStore';
import {
  TRUST_EVENT_STORAGE_KEY,
  useTrustEventStore,
} from '../../stores/trustEventStore';
import { useUIStore } from '../../stores/uiStore';
import { OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { Section } from './shared';
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
  type LinguaLocalStoreKey,
  type NetworkActivityFeature,
  type NetworkActivityStatus,
} from './privacyTrustHelpers';

/**
 * RL-096 Slice 1 — Privacy + Trust Dashboard root component.
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
 *      action (gated by a confirmation modal — fold C).
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
  const telemetryConsent = useSettingsStore((s) => s.telemetryConsent);
  // RL-044 Sub-slice G Fold E — reflects the master toggle in the
  // dashboard's Network table without owning the source of truth.
  const outputSourceMappingEnabled = useSettingsStore(
    (s) => s.outputSourceMappingEnabled
  );
  const licenseToken = useLicenseStore((s) => s.token);
  const clearLicense = useLicenseStore((s) => s.clearLicense);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  // Refresh trigger — bumped after every Clear so the size estimates
  // re-read localStorage. Cheap because the audited key list is tiny.
  const [, setRefreshTick] = useState(0);
  const [confirmKey, setConfirmKey] = useState<LinguaLocalStoreKey | null>(
    null
  );
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
    return buildNetworkActivityRows({
      telemetryConsent,
      licenseStatus: deriveLicenseStatus(licenseToken),
      capsuleExportLastAt: null,
      telemetryLastAt: null,
      updateCheckLastAt: null,
      // RL-044 Sub-slice G Fold E — reflects the master toggle so
      // the dashboard row stays in lock-step with Settings → Editor.
      outputSourceMappingEnabled,
    });
  }, [telemetryConsent, licenseToken, outputSourceMappingEnabled]);

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
    setRefreshTick((tick) => tick + 1);
  };

  return (
    <div
      className="space-y-6"
      data-testid="privacy-trust-section"
      data-surface={surface}
    >
      <Section
        id="privacy-trust"
        title={t('settings.privacy.title')}
        description={t('settings.privacy.hint')}
      >
        {/* Redaction preview */}
        <RedactionPreviewBlock
          input={pasteInput}
          result={previewResult}
          onChange={setPasteInput}
        />
      </Section>

      <Section
        title={t('settings.privacy.localStores.title')}
        description={t('settings.privacy.localStores.hint')}
      >
        <div className="overflow-x-auto rounded-[1.15rem] border border-border/80">
          <table
            className="min-w-full text-sm"
            data-testid="privacy-local-stores-table"
          >
            <thead className="bg-background-elevated/60 text-xs uppercase text-fg-subtle">
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
              {localRows.map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-border/60"
                  data-testid={`privacy-local-stores-row-${row.key}`}
                >
                  <td className="px-3 py-2 font-mono text-xs text-fg-base">
                    {row.key}
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {t(row.purposeKey)}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono text-xs text-fg-base"
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
      </Section>

      <Section
        title={t('settings.privacy.network.title')}
        description={t('settings.privacy.network.hint')}
      >
        <div className="overflow-x-auto rounded-[1.15rem] border border-border/80">
          <table
            className="min-w-full text-sm"
            data-testid="privacy-network-activity-table"
          >
            <thead className="bg-background-elevated/60 text-xs uppercase text-fg-subtle">
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
              {networkRows.map((row) => (
                <tr
                  key={row.feature}
                  className="border-t border-border/60"
                  data-testid={`privacy-network-row-${row.feature}`}
                >
                  <td className="px-3 py-2 text-xs text-fg-base">
                    {t(networkFeatureLabel(row.feature))}
                  </td>
                  <td className="px-3 py-2">
                    <NetworkStatusChip status={row.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {row.lastCallAt === null
                      ? t('settings.privacy.network.lastCall.never')
                      : formatRelativeTimestamp(row.lastCallAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

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
      <div>
        <h3 className="text-[14px] font-semibold leading-tight text-fg-base">
          {t('settings.privacy.redaction.title')}
        </h3>
        <p className="mt-1 max-w-[72ch] text-[12.5px] leading-relaxed text-fg-muted">
          {t('settings.privacy.redaction.hint')}
        </p>
      </div>
      <textarea
        value={input}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('settings.privacy.redaction.placeholder')}
        rows={4}
        spellCheck={false}
        aria-label={t('settings.privacy.redaction.title')}
        className="w-full rounded-md border border-border/80 bg-bg-elevated/80 p-3 text-sm font-mono text-fg-base focus:border-primary/60 focus:outline-none"
        data-testid="privacy-redaction-input"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border/60 bg-background-elevated/30 p-3">
          <p className="mb-2 text-xs uppercase text-fg-subtle">
            {t('settings.privacy.redaction.before')}
          </p>
          <pre
            className="max-h-40 overflow-auto text-[11px] leading-snug text-fg-base whitespace-pre-wrap break-words"
            data-testid="privacy-redaction-before"
          >
            {input.length === 0
              ? t('settings.privacy.redaction.empty')
              : input}
          </pre>
        </div>
        <div className="rounded-md border border-border/60 bg-background-elevated/30 p-3">
          <p className="mb-2 text-xs uppercase text-fg-subtle">
            {t('settings.privacy.redaction.after')}
          </p>
          <pre
            className="max-h-40 overflow-auto text-[11px] leading-snug text-fg-base whitespace-pre-wrap break-words"
            data-testid="privacy-redaction-after"
          >
            {input.length === 0
              ? t('settings.privacy.redaction.empty')
              : result.redacted}
          </pre>
        </div>
      </div>
    </div>
  );
}

function NetworkStatusChip({ status }: { status: NetworkActivityStatus }) {
  const { t } = useTranslation();
  const palette =
    status === 'enabled'
      ? 'border-success/40 bg-success/15 text-success'
      : status === 'disabled'
        ? 'border-warning/40 bg-warning/15 text-warning'
        : 'border-border/60 bg-background-elevated/60 text-fg-muted';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-wide ${palette}`}
      data-testid={`privacy-network-status-${status}`}
    >
      {t(`settings.privacy.network.status.${status}`)}
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
            className="font-display text-xl font-semibold text-foreground"
          >
            {t('settings.privacy.localStores.clear.confirmTitle')}
          </h2>
        </div>
        <div className="px-5 py-5 text-sm text-fg-muted">
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

function deriveLicenseStatus(
  token: string | null
): 'pro' | 'free' | 'invalid' | 'grace' {
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
