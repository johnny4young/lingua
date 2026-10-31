import { Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { canRecordTimeline } from '../../../shared/timeline';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';

/** Record run in the Run menu, for JS / TS Worker tabs while the timeline flag is on. */
export function RecordRunMenuItem({ disabled, onRecord }: { disabled: boolean; onRecord: () => void }) {
  const { t } = useTranslation();
  const on = useSettingsStore(state => state.featureFlags.runTimeline === true);
  const recordable = useEditorStore(state => {
    const tab = getActiveTab(state);
    return tab ? canRecordTimeline(tab) : false;
  });
  if (!on || !recordable) return null;
  return (
    <button
      type="button"
      role="menuitem"
      className="dropdown-rich-row w-full disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:[&_.row-icon]:opacity-45 disabled:[&_.row-label]:opacity-50"
      disabled={disabled}
      data-testid="action-pill-record"
      onClick={onRecord}
    >
      <span className="row-icon self-start mt-0.5">
        <Circle size={13} />
      </span>
      <span>
        <span className="row-label block">{t('actionPill.record.label')}</span>
        <span className="row-desc block">{t('actionPill.record.desc')}</span>
      </span>
      <span />
    </button>
  );
}
