/**
 * implementation note — ambient pill that flags "a stdin buffer
 * is staged for the next run on this tab". Mirrors the visual
 * language of `<AutoLogStatusPill>` / `<AutoRunGateNotice>` so
 * the run-time-affordance row in the result panel stays scannable.
 *
 * Self-gates on language (JS / TS / Python) AND non-empty buffer.
 * Hidden when:
 *   - The active tab is on an unsupported language.
 *   - The Settings master toggle is off (implementation note).
 *   - The buffer is empty / undefined.
 *   - The runtime mode is `browser-preview` (sandbox iframe has no
 *     stdin surface).
 */

import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useSettingsStore } from '../../stores/settingsStore';
import { StatusBadge } from '../ui/StatusBadge';

const SUPPORTED: ReadonlySet<string> = new Set([
  'javascript',
  'typescript',
  'python',
]);

export function StdinStatusPill() {
  const { t } = useTranslation();
  const showStdinPanel = useSettingsStore((state) => state.showStdinPanel);
  const activeTab = useActiveTab();

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

  // FASE 2b (MOV.05) — "stdin staged" is an informational marker, so
  // it adopts the quiet `neutral` StatusBadge tone. The MessageSquare
  // icon and the line-count label ride along as badge children; the
  // wrapper keeps the data-* hook and the tooltip.
  return (
    <span
      data-result-kind="stdin-pill"
      title={t('stdin.statusPill.tooltip', { lineCount })}
      className="inline-flex"
    >
      <StatusBadge tone="neutral">
        <MessageSquare size={10} aria-hidden="true" className="opacity-70" />
        {t('stdin.statusPill.label', { lineCount })}
      </StatusBadge>
    </span>
  );
}
