/**
 * RL-020 Slice 7 — ambient pill that surfaces the termination kind
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
 * Fold E — when the Settings toggle `showTimeoutCountdown` is on
 * AND a run is in flight (`runDeadlineAt` set), the pill renders a
 * `mm:ss` countdown variant instead of the post-termination one.
 * Default OFF so the panel stays quiet by default for users who
 * never asked for a live counter.
 */

import { useEffect, useState } from 'react';
import { AlarmClock, AlertTriangle, Hourglass, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';

function formatMmSs(remainingMs: number): string {
  const safeMs = Math.max(0, Math.floor(remainingMs));
  const seconds = Math.floor(safeMs / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export function RunStatusPill() {
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
    setNow(Date.now());
    return () => clearInterval(handle);
  }, [showCountdown, runDeadlineAt]);

  // In-flight countdown (fold E). Wins over the post-termination
  // variant so the user sees the live counter, not a stale "Error"
  // pill from a previous run.
  if (showCountdown && runDeadlineAt !== null) {
    const remaining = runDeadlineAt - now;
    const label = formatMmSs(Math.max(0, remaining));
    return (
      <span
        data-result-kind="run-status-pill"
        data-run-status="countdown"
        title={t('runtime.statusPill.countdown.tooltip', { label })}
        aria-label={t('runtime.statusPill.countdown.tooltip', { label })}
        className="inline-flex items-center gap-1 rounded-full bg-transparent px-1.5 text-[10px] italic text-muted"
      >
        <Hourglass size={10} aria-hidden="true" className="opacity-70" />
        {label}
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
          className="inline-flex items-center gap-1 rounded-full bg-transparent px-1.5 text-[10px] italic text-muted"
        >
          <AlarmClock size={10} aria-hidden="true" className="opacity-70" />
          {t('runtime.statusPill.timeout.label')}
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
          className="inline-flex items-center gap-1 rounded-full bg-transparent px-1.5 text-[10px] italic text-muted"
        >
          <Square size={10} aria-hidden="true" className="opacity-70" />
          {t('runtime.statusPill.stopped.label')}
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
          className="inline-flex items-center gap-1 rounded-full bg-transparent px-1.5 text-[10px] italic text-muted"
        >
          <AlertTriangle size={10} aria-hidden="true" className="opacity-70" />
          {t('runtime.statusPill.error.label')}
        </span>
      );
    }
    default:
      return null;
  }
}
