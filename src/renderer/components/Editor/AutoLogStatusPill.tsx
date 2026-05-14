/**
 * RL-020 Slice 5 fold E — ambient pill that surfaces in the result-
 * panel header when the active tab is in JS / TS Scratchpad mode AND
 * the bare-expression auto-log feature is active for that tab. Tells
 * the user "this is why your buffer suddenly has inline values
 * everywhere" without forcing them to look at Settings.
 *
 * Mirrors the visual language of `<WorkflowModeStatusPill>` and
 * `<AutoRunGateNotice>` so the row stays scannable. Reads the per-tab
 * override (fold C) layered on top of the per-language Settings
 * default — the same resolution `useAutoRun.ts` uses.
 */

import { MoveRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { defaultWorkflowMode } from '../../../shared/workflowMode';

export function AutoLogStatusPill() {
  const { t } = useTranslation();
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });
  const scratchpadAutoLogByLanguage = useSettingsStore(
    (state) => state.scratchpadAutoLogByLanguage
  );

  if (!activeTab) return null;
  const language = activeTab.language;
  if (language !== 'javascript' && language !== 'typescript') return null;

  const workflowMode =
    activeTab.workflowMode ?? defaultWorkflowMode(language);
  if (workflowMode !== 'scratchpad') return null;

  const enabled =
    activeTab.autoLogEnabled === undefined
      ? scratchpadAutoLogByLanguage[language] === true
      : activeTab.autoLogEnabled === true;
  if (!enabled) return null;

  const languageLabel = t(`autoLog.settings.${language}.label`);
  return (
    <span
      data-result-kind="autoLog-pill"
      title={t('autoLog.statusPill.tooltip', { language: languageLabel })}
      className="status-pill inline-flex items-center gap-1 text-[10px] italic"
    >
      <MoveRight size={10} aria-hidden="true" className="opacity-70" />
      {t('autoLog.statusPill.label', { language: languageLabel })}
    </span>
  );
}
