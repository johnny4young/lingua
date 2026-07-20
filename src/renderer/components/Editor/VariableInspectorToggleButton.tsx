/**
 * implementation — Variables toggle in the result-panel header.
 *
 * Mirrors `<CompareToggleButton>`  — button-secondary
 * shape, three states (hidden / disabled / enabled), pressed-state
 * indicator. The two toggles are mutually exclusive in
 * `ResultPanel.tsx`: toggling one ON forces the other OFF.
 *
 * Telemetry: emits `runtime.variable_inspector_opened` on each
 * user-driven flip (header click, palette action, keyboard
 * shortcut) so adoption is observable.
 */

import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useResultStore } from '../../stores/resultStore';
import { trackEvent } from '../../utils/telemetry';
import { syncVariableInspectorSurfaceAfterToggle } from '../../utils/variableInspectorSurface';
import { bucketVariableCount } from '../../../shared/scopeSnapshot';

export function VariableInspectorToggleButton() {
  const { t } = useTranslation();
  const activeTab = useActiveTab();
  const setTabVariableInspectorEnabled = useEditorStore(
    (state) => state.setTabVariableInspectorEnabled
  );
  const scopeSnapshot = useResultStore((state) => state.scopeSnapshot);

  if (!activeTab) return null;
  if (activeTab.runtimeMode === 'node') return null;

  const enabled = activeTab.variableInspectorEnabled === true;
  const snapshotIsRelevant =
    scopeSnapshot !== null && scopeSnapshot.language === activeTab.language;
  const canEnable = snapshotIsRelevant;

  const tooltipKey = !canEnable
    ? 'variableInspector.toggle.tooltipDisabled'
    : enabled
      ? 'variableInspector.toggle.tooltipEnabled'
      : 'variableInspector.toggle.tooltipReady';

  const handleClick = () => {
    if (!canEnable) return;
    const next = !enabled;
    setTabVariableInspectorEnabled(activeTab.id, next);
    syncVariableInspectorSurfaceAfterToggle(next);
    void trackEvent('runtime.variable_inspector_opened', {
      language: activeTab.language,
      variableCount: bucketVariableCount(scopeSnapshot?.variables.length ?? 0),
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
      data-testid="variable-inspector-toggle"
      data-state={canEnable ? (enabled ? 'on' : 'off') : 'disabled'}
      className={`button-secondary inline-flex items-center gap-1 px-2.5 py-1 font-mono text-eyebrow ${
        enabled
          ? 'border-primary/25 bg-primary-soft text-primary'
          : !canEnable
            ? 'opacity-50'
            : ''
      }`}
    >
      <Eye size={11} aria-hidden="true" className="opacity-80" />
      {t('variableInspector.toggle.label')}
    </button>
  );
}
