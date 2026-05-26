import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { BASELINE_SENSITIVE_HEADERS } from '../../../shared/httpWorkspace';
import { Row, Section, Toggle } from './shared';

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
    <Section
      title={t('privacy.title')}
      description={t('privacy.description')}
    >
      <Row
        label={t('privacy.telemetry.label')}
        hint={t('privacy.telemetry.hint')}
      >
        <div className="grid w-full gap-1 text-right">
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
            className="text-xs text-muted"
          >
            {t(statusKey)}
          </span>
        </div>
      </Row>
      <Row
        label={t('settings.nativeExecution.title')}
        hint={t('settings.nativeExecution.description')}
      >
        <div className="grid w-full gap-1 text-right">
          <button
            type="button"
            className="button-secondary justify-self-end"
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
            className="text-xs text-muted"
          >
            {t(nativeStatusKey)}
          </span>
        </div>
      </Row>
      <SensitiveHeadersRow />
    </Section>
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
    <Row
      label={t('settings.privacy.sensitiveHeaders.title')}
      hint={t('settings.privacy.sensitiveHeaders.description')}
    >
      <div
        className="grid w-full gap-1.5"
        data-testid="settings-sensitive-headers"
      >
        <ul role="list" className="flex flex-wrap items-center gap-1.5">
          {BASELINE_SENSITIVE_HEADERS.map((name) => (
            <li key={`baseline-${name}`}>
              <span
                data-testid="settings-sensitive-headers-baseline-chip"
                className="inline-flex items-center rounded-full bg-surface-strong/40 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted"
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
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
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
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
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
            className="h-7 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 text-xs focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={commit}
            disabled={draft.trim().length === 0}
            data-testid="settings-sensitive-headers-add"
            className="button-secondary text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('settings.privacy.sensitiveHeaders.add')}
          </button>
        </div>
      </div>
    </Row>
  );
}
