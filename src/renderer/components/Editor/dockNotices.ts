import { useTranslation } from 'react-i18next';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { resolveAutoLogEnabled } from '../../hooks/autoRunModel';
import { defaultWorkflowMode } from '../../../shared/workflowMode';

/** The active tab's language label while Scratchpad auto-log is on for it; null otherwise. */
export function useAutoLogLanguage(): string | null {
  const { t } = useTranslation();
  // Primitive selectors, so typing in the tab does not re-render the dock row.
  const language = useEditorStore((state) => getActiveTab(state)?.language);
  const workflowMode = useEditorStore((state) => getActiveTab(state)?.workflowMode);
  const tabOverride = useEditorStore((state) => getActiveTab(state)?.autoLogEnabled);
  const defaults = useSettingsStore((state) => state.scratchpadAutoLogByLanguage);

  if (!language) return null;
  const enabled = resolveAutoLogEnabled(language, workflowMode ?? defaultWorkflowMode(language), tabOverride, defaults);
  return enabled ? t(`workflowMode.languageLabel.${language}`) : null;
}

export interface AutoRunGateCopy {
  title: string;
  description: string;
  variant: 'browser-preview' | 'default';
}

/** The auto-run gate's copy while it holds the run; null otherwise. */
export function useAutoRunGateCopy(): AutoRunGateCopy | null {
  const { t } = useTranslation();
  const reason = useResultStore((state) => state.autoRunGateReason);
  const browserPreview = useEditorStore((state) => getActiveTab(state)?.runtimeMode === 'browser-preview');

  if (reason !== 'incomplete') return null;
  return browserPreview
    ? {
        title: t('autoRun.gate.incomplete.titleBrowserPreview'),
        description: t('autoRun.gate.incomplete.descriptionBrowserPreview'),
        variant: 'browser-preview',
      }
    : {
        title: t('autoRun.gate.incomplete.title'),
        description: t('autoRun.gate.incomplete.description'),
        variant: 'default',
      };
}
