import type { TFunction } from 'i18next';
import type { RuntimeTimeoutPreset } from '../../shared/runtimeTimeoutPresets';

/** Why a run timed out: its preset and limit, or the limit set for that run. */
export function timeoutTooltip(
  t: TFunction,
  summary: { timeoutPreset?: RuntimeTimeoutPreset | 'override'; timeoutMs?: number }
): string {
  const seconds = summary.timeoutMs ? Math.max(1, Math.round(summary.timeoutMs / 1000)) : null;
  if (!seconds) return t('runtime.statusPill.timeout.label');
  return summary.timeoutPreset && summary.timeoutPreset !== 'override'
    ? t('runtime.statusPill.timeout.tooltip', { preset: t(`runtime.timeout.preset.${summary.timeoutPreset}.label`), seconds })
    : t('runtime.statusPill.timeout.tooltipOverride', { seconds });
}
