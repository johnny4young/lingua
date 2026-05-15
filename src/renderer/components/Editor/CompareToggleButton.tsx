/**
 * RL-020 Slice 8 — Compare toggle in the result-panel header.
 *
 * Three states:
 *   - **hidden**: when the active tab is `executionMode === 'view'`
 *     (the parent gates this — the button always renders, the
 *     parent decides whether to mount it at all).
 *   - **disabled**: no comparator snapshot for the active language
 *     yet (first run hasn't happened, or a Save-As cleared the
 *     ring). Tooltip explains how to enable it; click is a no-op.
 *   - **enabled**: snapshot available. Clicking flips
 *     `compareWithSnapshotEnabled` on the active tab. Fires the
 *     `runtime.compare_view_toggled` adoption signal on the
 *     transition that opens the panel (fold A).
 *
 * Visual contract mirrors the `hideUndefined` button-secondary
 * shape so the header stays one tier visually. Active-state class
 * keys off the same `border-primary/25 bg-primary-soft
 * text-primary` palette used by `hideUndefined`.
 */

import { GitCompare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { trackEvent } from '../../utils/telemetry';

export function CompareToggleButton() {
  const { t } = useTranslation();
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });
  const setTabCompareEnabled = useEditorStore(
    (state) => state.setTabCompareEnabled
  );
  const snapshotRing = useResultStore((state) => state.snapshotRing);

  if (!activeTab) return null;

  const enabled = activeTab.compareWithSnapshotEnabled === true;
  // Snapshot's language must match the current tab's. Slice 8 keeps
  // this guard in the renderer too — even though the editor store
  // clears the snapshot on language change, this guards against
  // race windows (the active tab updates synchronously, the snapshot
  // clear is a subsequent action).
  const snapshotIsRelevant =
    snapshotRing.some((entry) => entry.language === activeTab.language);
  const canEnable = snapshotIsRelevant;

  const tooltipKey = !canEnable
    ? 'compare.toggle.tooltipDisabled'
    : enabled
      ? 'compare.toggle.tooltipEnabled'
      : 'compare.toggle.tooltipReady';

  const handleClick = () => {
    if (!canEnable) return;
    const next = !enabled;
    setTabCompareEnabled(activeTab.id, next);
    // Fire telemetry only on the transitions the user actually
    // initiated. Closed-enum payload — language is a safe token,
    // enabled is a boolean.
    void trackEvent('runtime.compare_view_toggled', {
      language: activeTab.language,
      enabled: next,
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={t(tooltipKey)}
      aria-label={t(tooltipKey)}
      aria-pressed={enabled}
      disabled={!canEnable}
      data-testid="compare-toggle"
      data-state={canEnable ? (enabled ? 'on' : 'off') : 'disabled'}
      className={`button-secondary inline-flex items-center gap-1 px-2.5 py-1 font-mono text-[10px] ${
        enabled
          ? 'border-primary/25 bg-primary-soft text-primary'
          : !canEnable
            ? 'opacity-50'
            : ''
      }`}
    >
      <GitCompare size={11} aria-hidden="true" className="opacity-80" />
      {t('compare.toggle.label')}
    </button>
  );
}
