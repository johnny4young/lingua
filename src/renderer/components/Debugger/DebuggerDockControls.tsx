import { useTranslation } from 'react-i18next';
import '../../i18n/debuggerCatalog';
import '../ui/identity.css';
import './debugger.css';
import { useDebuggerStore } from '../../stores/debuggerStore';

/**
 * Shows what each paused value held at the previous pause, while this tab is paused. It sits in the
 * dock row, or in the Locals head as its track alone when a compact dock has no room for it there.
 */
export function DebuggerChangesSwitch({ tabId, trackOnly = false }: { tabId: string | null; trackOnly?: boolean }) {
  const { t } = useTranslation();
  const paused = useDebuggerStore(state => state.pausedFrame !== null && state.pausedFrame.tabId === tabId);
  const show = useDebuggerStore(state => state.showPauseChanges);
  const setShow = useDebuggerStore(state => state.setShowPauseChanges);
  if (!paused) return null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={show}
      data-testid="debugger-changes-switch"
      className="type-tag debugger-changes-switch focus-ring"
      aria-label={t('debugger.changes.label')}
      title={t('debugger.changes.label')}
      onClick={() => setShow(!show)}
    >
      <span className="switch-track" aria-hidden />
      {!trackOnly && <span className="debugger-changes-label">{t('debugger.changes.label')}</span>}
    </button>
  );
}
