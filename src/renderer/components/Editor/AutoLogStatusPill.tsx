/**
 * implementation note — ambient pill that surfaces in the result-
 * panel header when the active tab is in JS / TS Scratchpad mode AND
 * the bare-expression auto-log feature is active for that tab. Tells
 * the user "this is why your buffer suddenly has inline values
 * everywhere" without forcing them to look at Settings.
 *
 * Mirrors the visual language of `<StdinStatusPill>` and
 * `<AutoRunGateNotice>` so the row stays scannable. Reads the per-tab
 * override (implementation note) layered on top of the per-language Settings
 * default — the same resolution `useAutoRun.ts` uses.
 */

import { MoveRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useSettingsStore } from '../../stores/settingsStore';
import { defaultWorkflowMode } from '../../../shared/workflowMode';
import { StatusBadge } from '../ui/StatusBadge';

export function AutoLogStatusPill() {
  const { t } = useTranslation();
  const activeTab = useActiveTab();
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
  // UI refinement — the file extension already says JS/TS; the pill
  // only needs to communicate "auto-log is on". Drop the language
  // tag from the visible label; keep it in the tooltip so screen
  // readers and slow-discover users still get the full context.
  //
  // FASE 2b (MOV.05) — "auto-log is on" is an informational ambient
  // marker, so it adopts the quiet `neutral` StatusBadge tone. The
  // MoveRight icon rides along as a badge child; the wrapper keeps the
  // data-* hook plus the title/aria the header relies on.
  return (
    <span
      data-result-kind="autoLog-pill"
      title={t('autoLog.statusPill.tooltip', { language: languageLabel })}
      aria-label={t('autoLog.statusPill.tooltip', { language: languageLabel })}
      className="inline-flex"
    >
      <StatusBadge tone="neutral">
        <MoveRight size={10} aria-hidden="true" className="opacity-70" />
        {t('autoLog.statusPill.shortLabel')}
      </StatusBadge>
    </span>
  );
}
