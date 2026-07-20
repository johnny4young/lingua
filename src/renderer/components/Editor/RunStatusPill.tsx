/**
 * implementation — ambient pill that surfaces the termination kind
 * of the most recent run (timeout / stopped / error). Hidden on
 * success, on the first paint, and while a run is in flight. Reads
 * `useResultStore.runTermination` set by `executeTabManually` and
 * `useAutoRun`.
 *
 * Visual language mirrors `<AutoLogStatusPill>` / `<StdinStatusPill>`
 * to keep the result-panel header consistent — italic chrome with a
 * low-contrast palette, no border, no background fill, never
 * button-styled. The icon swaps per kind so the row is scannable
 * without reading the label.
 *
 * implementation note — when the Settings toggle `showTimeoutCountdown` is on
 * AND a run is in flight (`runDeadlineAt` set), the pill renders a
 * `mm:ss` countdown variant instead of the post-termination one.
 * Default OFF so the panel stays quiet by default for users who
 * never asked for a live counter.
 *
 * implementation — when rendered inside the 24px persistent status bar
 * (`compact`), the post-termination badges drop their trailing text label so
 * the icon-only badge fits the bar height. The countdown keeps its `mm:ss`
 * label (it carries no icon-only equivalent). All gates (hidden on
 * success / idle / first paint) and `data-*` attrs are unchanged.
 */

import { useEffect, useState } from 'react';
import { AlarmClock, AlertTriangle, Hourglass, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { StatusBadge } from '../ui/StatusBadge';

function formatMmSs(remainingMs: number): string {
  const safeMs = Math.max(0, Math.floor(remainingMs));
  const seconds = Math.floor(safeMs / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export function RunStatusPill({ compact = false }: { compact?: boolean } = {}) {
  const { t } = useTranslation();
  const runTermination = useResultStore((state) => state.runTermination);
  const runDeadlineAt = useResultStore((state) => state.runDeadlineAt);
  const showCountdown = useSettingsStore((state) => state.showTimeoutCountdown);
  // Tick once per second while the in-flight pill is visible so the
  // countdown re-renders. The effect cleans up immediately when the
  // run terminates (deadline cleared) so we never leave a timer
  // attached for an idle pill.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!showCountdown || runDeadlineAt === null) return;
    const handle = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(handle);
  }, [showCountdown, runDeadlineAt]);

  // In-flight countdown (implementation note). Wins over the post-termination
  // variant so the user sees the live counter, not a stale "Error"
  // pill from a previous run. The countdown is informational (not an
  // alarm yet), so it adopts the quiet `neutral` StatusBadge tone.
  if (showCountdown && runDeadlineAt !== null) {
    const remaining = runDeadlineAt - now;
    const label = formatMmSs(Math.max(0, remaining));
    return (
      <span
        data-result-kind="run-status-pill"
        data-run-status="countdown"
        title={t('runtime.statusPill.countdown.tooltip', { label })}
        aria-label={t('runtime.statusPill.countdown.tooltip', { label })}
        className="inline-flex"
      >
        <StatusBadge tone="neutral">
          <Hourglass size={10} aria-hidden="true" className="opacity-70" />
          <span className="tabular-nums">{label}</span>
        </StatusBadge>
      </span>
    );
  }

  if (!runTermination) return null;
  if (runTermination.kind === 'success') return null;

  const presetKey = runTermination.timeoutPreset;
  const presetLabel =
    presetKey && presetKey !== 'override'
      ? t(`runtime.timeout.preset.${presetKey}.label`)
      : '';
  const seconds = runTermination.timeoutMs
    ? Math.max(1, Math.round(runTermination.timeoutMs / 1000))
    : null;

  switch (runTermination.kind) {
    case 'timeout': {
      const tooltip = seconds
        ? presetLabel
          ? t('runtime.statusPill.timeout.tooltip', {
              preset: presetLabel,
              seconds,
            })
          : t('runtime.statusPill.timeout.tooltipOverride', { seconds })
        : t('runtime.statusPill.timeout.label');
      return (
        <span
          data-result-kind="run-status-pill"
          data-run-status="timeout"
          title={tooltip}
          aria-label={tooltip}
          className="inline-flex"
        >
          <StatusBadge tone="warning" dot>
            <AlarmClock size={10} aria-hidden="true" className="opacity-70" />
            {compact ? null : t('runtime.statusPill.timeout.label')}
          </StatusBadge>
        </span>
      );
    }
    case 'stopped': {
      return (
        <span
          data-result-kind="run-status-pill"
          data-run-status="stopped"
          title={t('runtime.statusPill.stopped.tooltip')}
          aria-label={t('runtime.statusPill.stopped.tooltip')}
          className="inline-flex"
        >
          <StatusBadge tone="neutral" dot>
            <Square size={10} aria-hidden="true" className="opacity-70" />
            {compact ? null : t('runtime.statusPill.stopped.label')}
          </StatusBadge>
        </span>
      );
    }
    case 'error': {
      return (
        <span
          data-result-kind="run-status-pill"
          data-run-status="error"
          title={t('runtime.statusPill.error.tooltip')}
          aria-label={t('runtime.statusPill.error.tooltip')}
          className="inline-flex"
        >
          <StatusBadge tone="error" dot>
            <AlertTriangle size={10} aria-hidden="true" className="opacity-70" />
            {compact ? null : t('runtime.statusPill.error.label')}
          </StatusBadge>
        </span>
      );
    }
    default:
      return null;
  }
}
