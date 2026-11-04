import { Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { canRecordTimeline } from '../../../shared/timeline';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';

/** Record run in the Run menu, for JS / TS Worker tabs. */
export function RecordRunMenuItem({ disabled, onRecord }: { disabled: boolean; onRecord: () => void }) {
  const { t } = useTranslation();
  const recordable = useEditorStore(state => {
    const tab = getActiveTab(state);
    return tab ? canRecordTimeline(tab) : false;
  });
  if (!recordable) return null;
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
