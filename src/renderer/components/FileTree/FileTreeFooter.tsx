import type { ReactNode } from 'react';
import { Check, ChevronRight, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import { emitCommand } from '../../stores/commandBus';
import { useProjectTerminalStore } from '../../stores/projectTerminalStore';
import { useUIStore } from '../../stores/uiStore';
import { Kbd } from '../ui/chrome';
import { TestTallyMark } from './TestTallyMark';
import type { TestTally } from './fileTreeMarks';
import type { RootId } from '../../../shared/fs/brandedIds';

function FooterRow({ icon, label, testId, onClick, children }: { icon: ReactNode; label: string; testId: string; onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="focus-ring flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-body-sm text-foreground/88 transition-colors hover:bg-surface-strong/62 hover:text-foreground"
    >
      <span className="flex w-3.5 shrink-0 justify-center text-muted" aria-hidden>
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {children ? <span className="ml-auto flex shrink-0 items-center gap-1.5">{children}</span> : null}
    </button>
  );
}

/** Project-wide entry points under the tree: search, the Tests tab and the terminal. */
export function FileTreeFooter({ rootId, tests }: { rootId: RootId; tests: TestTally | null }) {
  const { t } = useTranslation();
  const searchShortcut = useShortcutLabel('nav-project-search');
  // A shell left running for another project is not this project's terminal.
  const terminalActive = useProjectTerminalStore(state => state.status === 'running' && state.rootId === rootId);
  const shellName = useProjectTerminalStore(state => state.shellName);
  const hasTests = Boolean(window.lingua?.projectTests);
  const hasTerminal = Boolean(window.lingua?.projectTerminal);

  return (
    <div className="border-t border-border/70 p-1" data-testid="file-tree-footer">
      <FooterRow
        icon={<Search size={12} />}
        label={t('explorer.searchInFiles')}
        testId="file-tree-footer-search"
        onClick={() => emitCommand('overlay.openProjectSearch')}
      >
        {searchShortcut ? <Kbd>{searchShortcut}</Kbd> : null}
      </FooterRow>
      {hasTests ? (
        <FooterRow
          icon={<Check size={12} />}
          label={t('bottomPanel.tabs.tests')}
          testId="file-tree-footer-tests"
          onClick={() => useUIStore.getState().openBottomPanel('tests')}
        >
          {tests && (tests.total > 0 || tests.tone === 'failed') ? <TestTallyMark tally={tests} testId="file-tree-footer-tests-tally" /> : null}
        </FooterRow>
      ) : null}
      {hasTerminal ? (
        <FooterRow
          icon={<ChevronRight size={12} />}
          label={t('bottomPanel.tabs.projectTerminal')}
          testId="file-tree-footer-terminal"
          onClick={() => useUIStore.getState().openBottomPanel('project-terminal')}
        >
          {terminalActive ? (
            <span className="text-caption text-muted" data-testid="file-tree-footer-terminal-state">
              {shellName ? `${shellName} · ` : ''}
              {t('explorer.terminalActive')}
            </span>
          ) : null}
        </FooterRow>
      ) : null}
    </div>
  );
}
