import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import {
  defaultWorkflowMode,
  type WorkflowMode,
} from '../../../shared/workflowMode';
import { StatusBadge } from '../ui/StatusBadge';

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

  // FASE 2b (MOV.05) — the ambient mode mirror is intentionally
  // low-contrast and non-warning, so it maps to the `neutral` tone of
  // the shared StatusBadge. The wrapper keeps the data-* hooks and the
  // tooltip the rest of the result-panel header relies on.
  return (
    <span
      data-testid="workflow-mode-status-pill"
      data-workflow-mode={mode}
      title={t('workflowMode.toggle.description')}
      className="inline-flex"
    >
      <StatusBadge tone="neutral">{t(MODE_LABEL_KEY[mode])}</StatusBadge>
    </span>
  );
}
