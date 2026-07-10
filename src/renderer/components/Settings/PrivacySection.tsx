import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { recordTrustEventBestEffort } from '../../stores/trustEventStore';
import { clearLedger, exportLedgerJson } from '../../runtime/runLedger';
import { trackEvent } from '../../utils/telemetry';
import { BASELINE_SENSITIVE_HEADERS } from '../../../shared/httpWorkspace';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import { Toggle } from './shared';

/**
 * Privacy section — owns the RL-065 telemetry consent toggle and the
 * RL-079 native-execution acknowledgement reset. Three-state telemetry
 * consent: `unset` (default, treated as opt-out), `granted`, `declined`.
 * Flipping the toggle moves between `granted` and `declined`; we never
 * revert to `unset` from the UI so the future first-run prompt stays
 * one-shot per install. Native execution acknowledgement is binary —
 * the modal flips it once, and this surface lets the user reset it
 * back so the warning re-appears on the next Go/Rust run.
 */
export function PrivacySection() {
  const { t } = useTranslation();
  const telemetryConsent = useSettingsStore((state) => state.telemetryConsent);
  const setTelemetryConsent = useSettingsStore((state) => state.setTelemetryConsent);
  const nativeExecutionAcknowledged = useSettingsStore(
    (state) => state.nativeExecutionAcknowledged
  );
  const setNativeExecutionAcknowledged = useSettingsStore(
    (state) => state.setNativeExecutionAcknowledged
  );
  const statusKey =
    telemetryConsent === 'granted'
      ? 'privacy.telemetry.granted'
      : telemetryConsent === 'declined'
        ? 'privacy.telemetry.declined'
        : 'privacy.telemetry.notSet';

  const nativeStatusKey = nativeExecutionAcknowledged
    ? 'settings.nativeExecution.acknowledged'
    : 'settings.nativeExecution.notAcknowledged';

  return (
    <SettingsSection
      eyebrow={t('privacy.title')}
      description={t('privacy.description')}
    >
      {/* Affine privacy controls grouped into one inset card. */}
      <SpecCard>
        <SpecRow
          label={t('privacy.telemetry.label')}
          description={t('privacy.telemetry.hint')}
          control={
            <div className="flex flex-col items-end gap-1">
              <Toggle
                value={telemetryConsent === 'granted'}
                onChange={() =>
                  setTelemetryConsent(telemetryConsent === 'granted' ? 'declined' : 'granted')
                }
                aria-label={t('privacy.telemetry.label')}
              />
              <span
                data-testid="telemetry-status"
                role="status"
                aria-live="polite"
                className="text-caption text-fg-subtle"
              >
                {t(statusKey)}
              </span>
            </div>
          }
        />
        <SpecRow
          label={t('settings.nativeExecution.title')}
          description={t('settings.nativeExecution.description')}
          control={
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setNativeExecutionAcknowledged(false)}
                disabled={!nativeExecutionAcknowledged}
                data-testid="native-execution-reset"
              >
                {t('settings.nativeExecution.reset')}
              </button>
              <span
                data-testid="native-execution-status"
                role="status"
                aria-live="polite"
                className="text-caption text-fg-subtle"
              >
                {t(nativeStatusKey)}
              </span>
            </div>
          }
        />
        <SensitiveHeadersRow />
      </SpecCard>
      {/* IT2-C1 — the local Run Ledger card: opt-in, clear, export. */}
      <SpecCard>
        <RunLedgerRows />
      </SpecCard>
    </SettingsSection>
  );
}

/**
 * IT2-C1 — Run Ledger controls. The ledger records MANUAL runs into the
 * `lingua_ledger` schema of the SQL workspace's DuckDB database: source
 * as a SHA-256 hash only, stdout previews from redacted capsules. Off by
 * default; durability across reloads additionally requires the SQL
 * workspace's OPFS persistence opt-in (Editor section), which the status
 * line under the toggle makes explicit. Clearing drops the schema;
 * exporting downloads every table as JSON.
 */
function RunLedgerRows() {
  const { t } = useTranslation();
  const runLedgerEnabled = useSettingsStore((state) => state.runLedgerEnabled);
  const setRunLedgerEnabled = useSettingsStore((state) => state.setRunLedgerEnabled);
  const persistTables = useSettingsStore((state) => state.sqlWorkspacePersistTables);
  const [busy, setBusy] = useState(false);

  const statusKey = !runLedgerEnabled
    ? 'privacy.runLedger.status.off'
    : persistTables
      ? 'privacy.runLedger.status.durable'
      : 'privacy.runLedger.status.sessionOnly';

  const handleToggle = () => {
    const next = !runLedgerEnabled;
    setRunLedgerEnabled(next);
    void trackEvent('ledger.toggled', { enabled: next });
    recordTrustEventBestEffort({
      feature: 'run-ledger',
      action: next ? 'enabled' : 'disabled',
      sensitivity: 'low',
      summary: next
        ? 'Run Ledger enabled (local DuckDB, hashes only)'
        : 'Run Ledger disabled',
    });
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      const ok = await clearLedger();
      void trackEvent('ledger.cleared', {});
      recordTrustEventBestEffort({
        feature: 'run-ledger',
        action: 'cleared',
        sensitivity: 'low',
        summary: 'Run Ledger schema dropped',
      });
      useUIStore.getState().pushStatusNotice({
        tone: ok ? 'success' : 'warning',
        messageKey: ok ? 'privacy.runLedger.toast.cleared' : 'privacy.runLedger.toast.clearFailed',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const json = await exportLedgerJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lingua-run-ledger-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      useUIStore.getState().pushStatusNotice({
        tone: 'success',
        messageKey: 'privacy.runLedger.toast.exported',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SpecRow
        label={t('privacy.runLedger.label')}
        description={t('privacy.runLedger.hint')}
        control={
          <div className="flex flex-col items-end gap-1">
            <Toggle
              value={runLedgerEnabled}
              onChange={handleToggle}
              aria-label={t('privacy.runLedger.label')}
              data-testid="run-ledger-toggle"
            />
            <span
              data-testid="run-ledger-status"
              role="status"
              aria-live="polite"
              className="text-caption text-fg-subtle"
            >
              {t(statusKey)}
            </span>
          </div>
        }
      />
      <SpecRow
        last
        label={t('privacy.runLedger.data.label')}
        description={t('privacy.runLedger.data.hint')}
        control={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="button-secondary"
              onClick={() => void handleExport()}
              disabled={busy}
              data-testid="run-ledger-export"
            >
              {t('privacy.runLedger.export')}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => void handleClear()}
              disabled={busy}
              data-testid="run-ledger-clear"
            >
              {t('privacy.runLedger.clear')}
            </button>
          </div>
        }
      />
    </>
  );
}

/**
 * RL-097 Slice 1 — Sensitive HTTP headers editor. Chip list with an
 * add-by-typing-Enter input. Baseline chips render disabled (the
 * baseline list is immutable from the UI; the renderer always merges
 * them at redaction time). User-added chips have an X to remove.
 */
function SensitiveHeadersRow() {
  const { t } = useTranslation();
  const userHeaders = useSettingsStore((state) => state.sensitiveHttpHeaders);
  const addSensitiveHttpHeader = useSettingsStore(
    (state) => state.addSensitiveHttpHeader
  );
  const removeSensitiveHttpHeader = useSettingsStore(
    (state) => state.removeSensitiveHttpHeader
  );
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    addSensitiveHttpHeader(trimmed);
    setDraft('');
    inputRef.current?.focus();
  }, [draft, addSensitiveHttpHeader]);

  return (
    <SpecRow
      last
      label={t('settings.privacy.sensitiveHeaders.title')}
      description={t('settings.privacy.sensitiveHeaders.description')}
      control={
        <div
          className="grid w-full max-w-[320px] gap-1.5"
          data-testid="settings-sensitive-headers"
        >
          <ul role="list" className="flex flex-wrap items-center justify-end gap-1.5">
            {BASELINE_SENSITIVE_HEADERS.map((name) => (
              <li key={`baseline-${name}`}>
                <span
                  data-testid="settings-sensitive-headers-baseline-chip"
                  className="inline-flex items-center rounded-full bg-bg-panel-alt px-2 py-0.5 text-caption font-medium tabular-nums text-fg-muted"
                  title={t('settings.privacy.sensitiveHeaders.baselineHint')}
                >
                  {name}
                </span>
              </li>
            ))}
            {userHeaders.map((name) => (
              <li key={`user-${name}`}>
                <span
                  data-testid="settings-sensitive-headers-user-chip"
                  className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-caption font-medium text-warning-fg"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeSensitiveHttpHeader(name)}
                    aria-label={t(
                      'settings.privacy.sensitiveHeaders.remove.aria',
                      { name }
                    )}
                    data-testid="settings-sensitive-headers-remove"
                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-warning-fg hover:bg-warning-border/30"
                  >
                    <X size={9} aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commit();
                }
              }}
              placeholder={t('settings.privacy.sensitiveHeaders.placeholder')}
              data-testid="settings-sensitive-headers-input"
              className="h-7 min-w-0 flex-1 rounded-md border border-border-default bg-bg-base px-2 text-body-sm text-fg-base focus:border-accent/55 focus:outline-none"
            />
            <button
              type="button"
              onClick={commit}
              disabled={draft.trim().length === 0}
              data-testid="settings-sensitive-headers-add"
              className="button-secondary text-body-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('settings.privacy.sensitiveHeaders.add')}
            </button>
          </div>
        </div>
      }
    />
  );
}
