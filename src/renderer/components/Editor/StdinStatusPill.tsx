/**
 * RL-020 Slice 6 fold F — ambient pill that flags "a stdin buffer
 * is staged for the next run on this tab". Mirrors the visual
 * language of `<WorkflowModeStatusPill>` / `<AutoLogStatusPill>` so
 * the run-time-affordance row in the result panel stays scannable.
 *
 * Self-gates on language (JS / TS / Python) AND non-empty buffer.
 * Hidden when:
 *   - The active tab is on an unsupported language.
 *   - The Settings master toggle is off (Slice 6 fold D).
 *   - The buffer is empty / undefined.
 *   - The runtime mode is `browser-preview` (sandbox iframe has no
 *     stdin surface).
 */

import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';

const SUPPORTED: ReadonlySet<string> = new Set([
  'javascript',
  'typescript',
  'python',
]);

export function StdinStatusPill() {
  const { t } = useTranslation();
  const showStdinPanel = useSettingsStore((state) => state.showStdinPanel);
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });

  if (!showStdinPanel) return null;
  if (!activeTab) return null;
  if (!SUPPORTED.has(activeTab.language)) return null;
  if (activeTab.runtimeMode === 'browser-preview') return null;
  const buffer = activeTab.stdinBuffer;
  if (!buffer || buffer.length === 0) return null;

  const lines = buffer.split('\n').filter((line, i, arr) =>
    i < arr.length - 1 ? true : line.length > 0
  );
  const lineCount = lines.length;
  if (lineCount === 0) return null;

  return (
    <span
      data-result-kind="stdin-pill"
      title={t('stdin.statusPill.tooltip', { lineCount })}
      className="status-pill inline-flex items-center gap-1 text-[10px]"
    >
      <MessageSquare size={10} aria-hidden="true" className="opacity-70" />
      {t('stdin.statusPill.label', { lineCount })}
    </span>
  );
}
