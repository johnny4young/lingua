import { Hammer, Play, PlayCircle, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isNotebookCodeCell, type NotebookCellV1 } from '../../../shared/notebook';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import { languageLabel } from '../../utils/languageMeta';
import { CommandBarContextChip, CommandBarSlot, CommandBarVerb } from '../Chrome/CommandBarSlot';

/** The notebook's context (active cell · language) and verb (Run cell) in the command bar. */
export function NotebookCommandBar({
  title,
  cells,
  activeCellId,
  isAnyCellRunning,
  canRunAll,
  canRunAbove,
  canRunFromHere,
  onRunCell,
  onRunAll,
  onRunAbove,
  onRunFromHere,
  onStop,
}: {
  /** Names the context when no cell is selected. */
  title: string;
  cells: readonly NotebookCellV1[];
  activeCellId: string | null;
  isAnyCellRunning: boolean;
  canRunAll: boolean;
  canRunAbove: boolean;
  canRunFromHere: boolean;
  onRunCell: (cellId: string) => void;
  onRunAll: () => void;
  onRunAbove: () => void;
  onRunFromHere: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const runShortcut = useShortcutLabel('run-toggle');
  const index = activeCellId === null ? -1 : cells.findIndex((cell) => cell.id === activeCellId);
  const cell = index >= 0 ? cells[index] : undefined;
  const codeCell = cell && isNotebookCodeCell(cell) ? cell : undefined;

  return (
    <>
      <CommandBarSlot slot="context">
        <CommandBarContextChip
          testId="notebook-command-bar-cell"
          {...(codeCell ? { badge: codeCell.language, detail: languageLabel(codeCell.language) } : {})}
          name={cell ? t('notebook.cell.indexLabel', { index: index + 1 }) : title}
        />
      </CommandBarSlot>
      <CommandBarSlot slot="verb">
        {isAnyCellRunning ? (
          <CommandBarVerb
            running
            label={t('notebook.toolbar.stop')}
            icon={<Square size={11} fill="currentColor" />}
            onClick={onStop}
            testId="notebook-command-bar-stop"
          />
        ) : (
          <CommandBarVerb
            label={t('notebook.cell.runCell')}
            icon={<Play size={11} />}
            {...(runShortcut ? { shortcut: runShortcut } : {})}
            onClick={() => {
              if (codeCell) onRunCell(codeCell.id);
            }}
            disabled={!codeCell}
            testId="notebook-command-bar-run-cell"
            menu={{
              label: t('actionPill.moreRunOptions'),
              testId: 'notebook-command-bar-run-menu',
              listTestId: 'notebook-command-bar-run-menu-list',
              items: [
                { id: 'all', label: t('notebook.toolbar.runAll'), icon: <Play size={13} />, disabled: !canRunAll, testId: 'notebook-command-bar-run-all', onSelect: onRunAll },
                { id: 'above', label: t('notebook.toolbar.runAbove'), icon: <Hammer size={13} />, disabled: !canRunAbove, testId: 'notebook-command-bar-run-above', onSelect: onRunAbove },
                { id: 'from-here', label: t('notebook.toolbar.runFromHere'), icon: <PlayCircle size={13} />, disabled: !canRunFromHere, testId: 'notebook-command-bar-run-from-here', onSelect: onRunFromHere },
              ],
            }}
          />
        )}
      </CommandBarSlot>
    </>
  );
}
