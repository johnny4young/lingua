import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import {
  defaultWorkflowMode,
  type WorkflowMode,
} from '../../../shared/workflowMode';

/**
 * RL-020 Slice 2 fold B — ambient pill that mirrors the active tab's
 * workflow mode inside the result-panel header.
 *
 * Why it lives here (and not only in the toolbar): users with the
 * result panel open and the toolbar partially obscured (small
 * viewport, sidebar open, etc.) need a local signal explaining "why
 * didn't my code run?" — they're staring at the result panel, not
 * the toolbar. The pill is intentionally low-contrast so it doesn't
 * fight the AutoRunGateNotice (which is the higher-priority warning
 * state).
 *
 * Renders for every tab. Hidden only when no tab is active.
 */

const MODE_LABEL_KEY: Record<WorkflowMode, string> = {
  run: 'workflowMode.run.label',
  debug: 'workflowMode.debug.label',
  scratchpad: 'workflowMode.scratchpad.label',
};

export function WorkflowModeStatusPill() {
  const { t } = useTranslation();
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });
  if (!activeTab) return null;

  const mode: WorkflowMode =
    activeTab.workflowMode ?? defaultWorkflowMode(activeTab.language);

  return (
    <span
      data-testid="workflow-mode-status-pill"
      data-workflow-mode={mode}
      title={t('workflowMode.toggle.description')}
      className="status-pill border-border/40 bg-surface-strong/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted"
    >
      {t(MODE_LABEL_KEY[mode])}
    </span>
  );
}
