import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';

/**
 * RL-020 Slice 1 — ambient footer notice for the auto-run completion
 * gate.
 *
 * Renders inside the result panel header (next to the execution-time
 * pill) when `autoRunGateReason === 'incomplete'`. One line,
 * `text-[11px] text-muted`, no icon, no toast — intentionally quiet
 * so it doesn't fight the user's editing flow.
 *
 * Fold E — when the active tab is in `runtimeMode === 'browser-
 * preview'`, the copy swaps to the "Preview paused" variant so a DOM-
 * oriented user knows that what is paused is the iframe re-render,
 * not the console refresh.
 */
export function AutoRunGateNotice() {
  const { t } = useTranslation();
  const reason = useResultStore((state) => state.autoRunGateReason);
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });

  if (reason !== 'incomplete') return null;

  const isBrowserPreview = activeTab?.runtimeMode === 'browser-preview';
  const titleKey = isBrowserPreview
    ? 'autoRun.gate.incomplete.titleBrowserPreview'
    : 'autoRun.gate.incomplete.title';
  const descriptionKey = isBrowserPreview
    ? 'autoRun.gate.incomplete.descriptionBrowserPreview'
    : 'autoRun.gate.incomplete.description';

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="auto-run-gate-notice"
      data-gate-variant={isBrowserPreview ? 'browser-preview' : 'default'}
      className="status-pill border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium tracking-[0.02em] text-warning"
      title={t(descriptionKey)}
    >
      {t(titleKey)}
    </span>
  );
}
