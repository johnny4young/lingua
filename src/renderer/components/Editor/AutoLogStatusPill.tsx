/**
 * Ambient pill that surfaces in the result-
 * panel header when the active tab is in JS / TS Scratchpad mode AND
 * the bare-expression auto-log feature is active for that tab. Tells
 * the user "this is why your buffer suddenly has inline values
 * everywhere" without forcing them to look at Settings.
 *
 * Mirrors the visual language of
 * `<AutoRunGateNotice>` so the row stays scannable.
 */

import { MoveRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../ui/StatusBadge';
import { useAutoLogLanguage } from './dockNotices';

export function AutoLogStatusPill() {
  const { t } = useTranslation();
  const languageLabel = useAutoLogLanguage();
  if (languageLabel === null) return null;

  // UI refinement — the file extension already says JS/TS; the pill
  // only needs to communicate "auto-log is on". Drop the language
  // tag from the visible label; keep it in the tooltip so screen
  // readers and slow-discover users still get the full context.
  //
  // "auto-log is on" is an informational ambient
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
