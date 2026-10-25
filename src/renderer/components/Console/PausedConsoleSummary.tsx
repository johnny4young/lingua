import { useTranslation } from 'react-i18next';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { useUIStore } from '../../stores/uiStore';
import { localsChanges } from '../../utils/debuggerLocals';

const SUMMARY_VALUES = 3;

/** The Console's footer while execution is paused: where, what the last step changed, and the way to the frame. */
export function PausedConsoleSummary() {
  const { t } = useTranslation();
  const frame = useDebuggerStore((state) => state.pausedFrame);
  const previous = useDebuggerStore((state) => state.previousPause);
  if (!frame) return null;
  const changed = [...localsChanges(previous?.tabId === frame.tabId ? previous.locals : null, frame.locals).keys()]
    .slice(0, SUMMARY_VALUES)
    .map((name) => `${name} → ${frame.locals[name]}`);

  return (
    <div
      role="status"
      data-testid="console-paused-summary"
      className="flex shrink-0 items-center gap-3 border-t border-border-subtle bg-accent-tint px-3 py-1.5 text-caption"
    >
      <span className="font-semibold text-accent-fg">{t('console.paused.title', { line: frame.line })}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-fg-base">
        {changed.length > 0 ? changed.join('  ·  ') : <span className="font-sans text-fg-muted">{t('console.paused.hint')}</span>}
      </span>
      <button
        type="button"
        onClick={() => useUIStore.getState().openBottomPanel('debugger')}
        className="focus-ring shrink-0 rounded-md border border-border-subtle bg-bg-panel px-2 py-0.5 font-medium text-fg-base hover:bg-bg-inset"
      >
        {t('console.paused.openDebugger')}
      </button>
    </div>
  );
}
