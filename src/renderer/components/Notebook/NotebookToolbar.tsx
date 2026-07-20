import {
  CodeXml,
  FileText,
  Hammer,
  Keyboard,
  Loader2,
  Play,
  RotateCcw,
  Eraser,
  PlayCircle,
  Square,
  Sparkles,
} from 'lucide-react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { NotebookCellLanguage, NotebookV1 } from '../../../shared/notebook';
import { cn } from '../../utils/cn';
import { Kbd } from '../ui/ModalShell';

const NOTEBOOK_SHORTCUT_HINTS: ReadonlyArray<{
  readonly keys: ReadonlyArray<string>;
  readonly labelKey: string;
}> = [
  { keys: ['Enter'], labelKey: 'notebook.command.legend.edit' },
  { keys: ['Esc'], labelKey: 'notebook.command.legend.command' },
  { keys: ['j', 'k'], labelKey: 'notebook.command.legend.navigate' },
  { keys: ['a', 'b'], labelKey: 'notebook.command.legend.insert' },
  { keys: ['d', 'd'], labelKey: 'notebook.command.legend.delete' },
  { keys: ['z'], labelKey: 'notebook.command.legend.undo' },
  { keys: ['m', 'y'], labelKey: 'notebook.command.legend.changeType' },
  { keys: ['⌘/Ctrl', '↵'], labelKey: 'notebook.command.legend.runInPlace' },
  { keys: ['⇧', '↵'], labelKey: 'notebook.command.legend.runAdvance' },
  { keys: ['⌥', '↵'], labelKey: 'notebook.command.legend.runInsert' },
  { keys: ['Ctrl', 'C'], labelKey: 'notebook.command.legend.interrupt' },
];

interface NotebookToolbarProps {
  readonly notebook: NotebookV1;
  readonly titleDraft: string | null;
  readonly setTitleDraft: Dispatch<SetStateAction<string | null>>;
  readonly handleTitleCommit: (value: string) => void;
  readonly codeCellsCount: number;
  readonly handleAddMarkdown: () => void;
  readonly disabled: boolean;
  readonly handleAddCode: (language: NotebookCellLanguage) => void;
  readonly preferredCodeLanguage: NotebookCellLanguage;
  readonly activeCellId: string | null;
  readonly runAbove: (tabId: string, cellId: string) => void;
  readonly tabId: string;
  readonly canRunThroughActiveCell: boolean;
  readonly handleRunFromHere: () => void;
  readonly canRunFromActiveCell: boolean;
  readonly handleRunAll: () => void;
  readonly lastCodeCellId: string | null;
  readonly isAnyCellRunning: boolean;
  readonly stop: () => void;
  readonly handleRestart: () => void;
  readonly handleClearOutputs: () => void;
  readonly hasOutputsToClear: boolean;
  readonly exportMenuAnchorRef: RefObject<HTMLDivElement | null>;
  readonly setExportMenuOpen: Dispatch<SetStateAction<boolean>>;
  readonly exportMenuOpen: boolean;
  readonly handleExport: () => void;
  readonly handleExportIpynb: () => void;
  readonly handleExportLinguanb: () => void;
  readonly exportLanguageLabel: string;
  readonly shortcutsAnchorRef: RefObject<HTMLDivElement | null>;
  readonly setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  readonly shortcutsOpen: boolean;
}

export function NotebookToolbar(props: NotebookToolbarProps) {
  const { t } = useTranslation();
  const {
    notebook, titleDraft, setTitleDraft, handleTitleCommit, codeCellsCount,
    handleAddMarkdown, disabled, handleAddCode, preferredCodeLanguage,
    activeCellId, runAbove, tabId, canRunThroughActiveCell, handleRunFromHere,
    canRunFromActiveCell, handleRunAll, lastCodeCellId, isAnyCellRunning,
    stop, handleRestart, handleClearOutputs, hasOutputsToClear,
    exportMenuAnchorRef, setExportMenuOpen, exportMenuOpen, handleExport,
    handleExportIpynb, handleExportLinguanb, exportLanguageLabel,
    shortcutsAnchorRef, setShortcutsOpen, shortcutsOpen,
  } = props;
  return (
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-surface/30 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="text"
            value={titleDraft ?? notebook.title}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={(event) => handleTitleCommit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleTitleCommit(event.currentTarget.value);
              } else if (event.key === 'Escape') {
                setTitleDraft(null);
              }
            }}
            data-testid="notebook-title"
            spellCheck={false}
            aria-label={t('notebook.titleLabel')}
            className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-2 py-1 font-display text-body font-semibold tracking-tight text-foreground hover:border-border/40 focus:border-border-strong focus:bg-bg-elevated focus:outline-none"
          />
          <span className="hidden text-eyebrow uppercase tracking-wider text-muted sm:inline">
            {t('notebook.toolbar.summary', {
              cells: notebook.cells.length,
              codeCells: codeCellsCount,
            })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleAddMarkdown}
            disabled={disabled}
            data-testid="notebook-toolbar-add-markdown"
            className="button-ghost px-2.5 text-caption"
          >
            <FileText size={11} aria-hidden="true" />
            {t('notebook.toolbar.addMarkdown')}
          </button>
          <button
            type="button"
            onClick={() => handleAddCode(preferredCodeLanguage)}
            disabled={disabled}
            data-testid="notebook-toolbar-add-code"
            className="button-ghost px-2.5 text-caption"
          >
            <CodeXml size={11} aria-hidden="true" />
            {t('notebook.toolbar.addCode')}
          </button>
          <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
          <button
            type="button"
            onClick={() => {
              if (activeCellId) runAbove(tabId, activeCellId);
            }}
            disabled={disabled || !canRunThroughActiveCell}
            data-testid="notebook-toolbar-run-above"
            className="button-ghost px-2.5 text-caption"
          >
            <Hammer size={11} aria-hidden="true" />
            {t('notebook.toolbar.runAbove')}
          </button>
          <button
            type="button"
            onClick={handleRunFromHere}
            disabled={disabled || !canRunFromActiveCell}
            data-testid="notebook-toolbar-run-from-here"
            className="button-ghost px-2.5 text-caption"
          >
            <PlayCircle size={11} aria-hidden="true" />
            {t('notebook.toolbar.runFromHere')}
          </button>
          <button
            type="button"
            onClick={handleRunAll}
            disabled={disabled || lastCodeCellId === null}
            data-testid="notebook-toolbar-run-all"
            className={cn(
              'focus-ring inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-caption font-medium transition-colors duration-150',
              disabled
                ? 'border-border/40 bg-surface/40 text-muted'
                : 'border-success-border bg-success-bg text-success-fg hover:border-success-fg',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {isAnyCellRunning ? (
              <>
                <Loader2 size={11} aria-hidden="true" className="animate-spin" />
                {t('notebook.toolbar.running')}
              </>
            ) : (
              <>
                <Play size={11} aria-hidden="true" />
                {t('notebook.toolbar.runAll')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={!isAnyCellRunning}
            data-testid="notebook-toolbar-stop"
            className="focus-ring inline-flex items-center gap-1 rounded-lg border border-warning-border bg-warning-bg px-2.5 py-1.5 text-caption font-medium text-warning-fg transition-colors duration-150 hover:border-warning-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Square size={11} aria-hidden="true" />
            {t('notebook.toolbar.stop')}
          </button>
          <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
          <button
            type="button"
            onClick={handleRestart}
            disabled={disabled}
            title={t('notebook.toolbar.restartHint')}
            data-testid="notebook-toolbar-restart"
            className="button-ghost px-2.5 text-caption"
          >
            <RotateCcw size={11} aria-hidden="true" />
            {t('notebook.toolbar.restart')}
          </button>
          <button
            type="button"
            onClick={handleClearOutputs}
            disabled={disabled || !hasOutputsToClear}
            data-testid="notebook-toolbar-clear-outputs"
            className="button-ghost px-2.5 text-caption"
          >
            <Eraser size={11} aria-hidden="true" />
            {t('notebook.toolbar.clearOutputs')}
          </button>
          {/* implementation — export-format menu (Script | Jupyter .ipynb),
              same popover mechanics as the shortcuts legend. */}
          <div className="relative" ref={exportMenuAnchorRef}>
            <button
              type="button"
              onClick={() => setExportMenuOpen((open) => !open)}
              disabled={disabled || codeCellsCount === 0}
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
              data-testid="notebook-toolbar-export"
              className="button-ghost px-2.5 text-caption"
            >
              <Sparkles size={11} aria-hidden="true" />
              {t('notebook.toolbar.export')}
            </button>
            {exportMenuOpen ? (
              <div
                role="menu"
                aria-label={t('notebook.toolbar.exportMenuLabel')}
                data-testid="notebook-export-menu"
                className="absolute right-0 top-9 z-20 w-60 rounded-md border border-border/60 bg-bg-elevated p-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExport}
                  data-testid="notebook-export-script"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-caption text-muted hover:bg-surface/60 hover:text-foreground"
                >
                  {t('notebook.toolbar.exportScript', {
                    language: exportLanguageLabel,
                  })}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExportIpynb}
                  data-testid="notebook-export-ipynb"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-caption text-muted hover:bg-surface/60 hover:text-foreground"
                >
                  {t('notebook.toolbar.exportAsIpynb')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExportLinguanb}
                  data-testid="notebook-export-linguanb"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-caption text-muted hover:bg-surface/60 hover:text-foreground"
                >
                  {t('notebook.toolbar.exportAsLinguanb')}
                </button>
              </div>
            ) : null}
          </div>
          <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
          <div className="relative" ref={shortcutsAnchorRef}>
            <button
              type="button"
              onClick={() => setShortcutsOpen((open) => !open)}
              aria-expanded={shortcutsOpen}
              aria-haspopup="dialog"
              aria-label={t('notebook.command.shortcutsTitle')}
              title={t('notebook.command.shortcutsTitle')}
              data-testid="notebook-toolbar-shortcuts"
              className={cn(
                'focus-ring inline-flex h-[28px] w-[28px] items-center justify-center rounded-lg border text-caption transition-colors duration-150',
                shortcutsOpen
                  ? 'border-primary/60 bg-primary/10 text-foreground'
                  : 'border-transparent text-muted hover:bg-surface-strong/60 hover:text-foreground'
              )}
            >
              <Keyboard size={12} aria-hidden="true" />
            </button>
            {shortcutsOpen ? (
              <div
                role="dialog"
                aria-label={t('notebook.command.shortcutsTitle')}
                data-testid="notebook-shortcuts-legend"
                className="absolute right-0 top-9 z-20 w-72 rounded-md border border-border/60 bg-bg-elevated p-3 shadow-lg"
              >
                <p className="mb-2 text-eyebrow font-semibold uppercase tracking-wider text-muted">
                  {t('notebook.command.shortcutsTitle')}
                </p>
                <ul className="grid gap-1.5">
                  {NOTEBOOK_SHORTCUT_HINTS.map(({ keys, labelKey }) => (
                    <li
                      key={labelKey}
                      className="flex items-center justify-between gap-2 text-caption text-foreground"
                    >
                      <span>{t(labelKey)}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {keys.map((cap) => (
                          <Kbd key={cap}>{cap}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </header>
  );
}
