import { ChevronDown, Keyboard, MoreHorizontal, Play, RotateCcw, Square, Upload } from 'lucide-react';
import { Fragment, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n/notebookCatalog';
import { useDismissible } from '../../hooks/useDismissible';
import { useMenuKeyboard } from '../../hooks/useMenuKeyboard';
import type { NotebookV1 } from '../../../shared/notebook';
import { IconButton, Kbd } from '../ui/chrome';
import { ICON_GLYPH } from '../ui/iconScale';
import { NotebookDocumentActions } from './NotebookDocumentActions';
import { NotebookStaleNotice } from './NotebookStaleNotice';
import { useNotebookToolbarFit } from './useNotebookToolbarFit';
import './notebookToolbar.css';

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
  readonly disabled: boolean;
  readonly activeCellId: string | null;
  readonly runAbove: (tabId: string, cellId: string) => void;
  readonly tabId: string;
  readonly canRunThroughActiveCell: boolean;
  readonly handleRunFromHere: () => void;
  readonly canRunFromActiveCell: boolean;
  readonly handleRunAll: () => void;
  readonly staleCount: number;
  readonly handleRefreshStale: () => void;
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

interface ToolbarAction {
  readonly testId: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly title?: string;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}

export function NotebookToolbar(props: NotebookToolbarProps) {
  const { t, i18n } = useTranslation();
  const {
    notebook,
    titleDraft,
    setTitleDraft,
    handleTitleCommit,
    codeCellsCount,
    disabled,
    activeCellId,
    runAbove,
    tabId,
    canRunThroughActiveCell,
    handleRunFromHere,
    canRunFromActiveCell,
    handleRunAll,
    staleCount,
    handleRefreshStale,
    lastCodeCellId,
    isAnyCellRunning,
    stop,
    handleRestart,
    handleClearOutputs,
    hasOutputsToClear,
    exportMenuAnchorRef,
    setExportMenuOpen,
    exportMenuOpen,
    handleExport,
    handleExportIpynb,
    handleExportLinguanb,
    exportLanguageLabel,
    shortcutsAnchorRef,
    setShortcutsOpen,
    shortcutsOpen,
  } = props;
  const rowRef = useRef<HTMLElement | null>(null);
  const { step, showsMeta, kernelInMenu, runRangeInMenu } = useNotebookToolbarFit(
    rowRef,
    `${i18n.language}|${notebook.title}|${notebook.cells.length}|${codeCellsCount}|${String(staleCount).length * Math.sign(staleCount)}|${isAnyCellRunning}`
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const closeMore = () => {
    setMoreOpen(false);
    moreTriggerRef.current?.focus();
  };

  const runRange: ToolbarAction[] = [
    {
      testId: 'notebook-toolbar-run-above',
      label: t('notebook.toolbar.runAbove'),
      disabled: disabled || !canRunThroughActiveCell,
      onSelect: () => {
        if (activeCellId) runAbove(tabId, activeCellId);
      },
    },
    {
      testId: 'notebook-toolbar-run-from-here',
      label: t('notebook.toolbar.runFromHere'),
      disabled: disabled || !canRunFromActiveCell,
      onSelect: handleRunFromHere,
    },
  ];
  const kernel: ToolbarAction[] = [
    {
      testId: 'notebook-toolbar-restart',
      label: t('notebook.toolbar.restart'),
      icon: <RotateCcw size={13} aria-hidden="true" />,
      title: t('notebook.toolbar.restartHint'),
      disabled,
      onSelect: handleRestart,
    },
    {
      testId: 'notebook-toolbar-clear-outputs',
      label: t('notebook.toolbar.clearOutputs'),
      disabled: disabled || !hasOutputsToClear,
      onSelect: handleClearOutputs,
    },
  ];
  const exportDisabled = disabled || codeCellsCount === 0;
  const menuGroups = [runRangeInMenu ? runRange : [], kernelInMenu ? kernel : []].filter(group => group.length > 0);
  // A wider row can empty ⋯ while it is open; it closes instead of floating empty.
  if (moreOpen && menuGroups.length === 0) setMoreOpen(false);
  const moreShown = moreOpen && menuGroups.length > 0;
  // The ⋯ menu and the export menu share one anchor, so Export opens from wherever it sits.
  useDismissible(moreShown, exportMenuAnchorRef, setMoreOpen, moreTriggerRef);
  useMenuKeyboard(moreShown, moreMenuRef);
  useDismissible(exportMenuOpen, exportMenuAnchorRef, setExportMenuOpen, kernelInMenu ? moreTriggerRef : exportTriggerRef);
  useMenuKeyboard(exportMenuOpen, exportMenuRef);

  const exportMenu = exportMenuOpen ? (
    <div
      ref={exportMenuRef}
      role="menu"
      aria-label={t('notebook.toolbar.exportMenuLabel')}
      data-testid="notebook-export-menu"
      className="notebook-toolbar-menu w-60"
    >
      <button type="button" role="menuitem" onClick={handleExport} data-testid="notebook-export-script" className="notebook-toolbar-menu-item">
        {t('notebook.toolbar.exportScript', { language: exportLanguageLabel })}
      </button>
      <button type="button" role="menuitem" onClick={handleExportIpynb} data-testid="notebook-export-ipynb" className="notebook-toolbar-menu-item">
        {t('notebook.toolbar.exportAsIpynb')}
      </button>
      <button type="button" role="menuitem" onClick={handleExportLinguanb} data-testid="notebook-export-linguanb" className="notebook-toolbar-menu-item">
        {t('notebook.toolbar.exportAsLinguanb')}
      </button>
    </div>
  ) : null;

  return (
    <header ref={rowRef} data-testid="notebook-toolbar" data-fit={step} className="notebook-toolbar bg-surface/30">
      <NotebookDocumentActions tabId={tabId} />
      <input
        type="text"
        value={titleDraft ?? notebook.title}
        onChange={event => setTitleDraft(event.target.value)}
        onBlur={event => handleTitleCommit(event.target.value)}
        onKeyDown={event => {
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
        className="notebook-toolbar-title truncate rounded border border-transparent bg-transparent px-2 py-1 text-body font-semibold tracking-tight text-foreground hover:border-border/40 focus:border-border-strong focus:outline-none"
      />
      {showsMeta ? (
        <span className="mx-1 flex-none text-eyebrow uppercase tracking-wider text-muted" data-testid="notebook-toolbar-summary">
          {t('notebook.toolbar.summary', { count: notebook.cells.length, codeCells: codeCellsCount })}
        </span>
      ) : null}
      <span className="notebook-toolbar-run-slot">
        <button
          type="button"
          onClick={handleRunAll}
          disabled={disabled || lastCodeCellId === null}
          data-testid="notebook-toolbar-run-all"
          className={`notebook-toolbar-button focus-ring ${isAnyCellRunning ? 'invisible' : ''}`}
        >
          <Play size={12} aria-hidden="true" fill="currentColor" />
          {t('notebook.toolbar.runAll')}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!isAnyCellRunning}
          data-testid="notebook-toolbar-stop"
          className={`notebook-toolbar-button notebook-toolbar-stop focus-ring ${isAnyCellRunning ? '' : 'invisible'}`}
        >
          <Square size={11} aria-hidden="true" fill="currentColor" />
          {t('notebook.toolbar.stop')}
        </button>
      </span>
      {runRangeInMenu ? null : runRange.map(action => <InlineAction key={action.testId} action={action} />)}
      {kernelInMenu ? null : (
        <>
          <span className="toolbar-divider" aria-hidden="true" />
          {kernel.map(action => (
            <InlineAction key={action.testId} action={action} />
          ))}
        </>
      )}
      <div className="relative flex-none" ref={exportMenuAnchorRef}>
        {kernelInMenu ? null : (
            <button
              ref={exportTriggerRef}
              type="button"
              onClick={() => setExportMenuOpen(open => !open)}
              disabled={exportDisabled}
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
              data-testid="notebook-toolbar-export"
              className="notebook-toolbar-button focus-ring"
            >
              <Upload size={13} aria-hidden="true" />
              {t('notebook.toolbar.export')}
              <ChevronDown size={11} aria-hidden="true" />
            </button>
        )}
        {menuGroups.length > 0 ? (
          <IconButton
            ref={moreTriggerRef}
            onClick={() => {
              setExportMenuOpen(false);
              setMoreOpen(open => !open);
            }}
            aria-expanded={moreShown}
            aria-haspopup="menu"
            tooltip={t('notebookToolbar.more')}
            tooltipSide="bottom"
            data-testid="notebook-toolbar-more"
          >
            <MoreHorizontal size={ICON_GLYPH.md} aria-hidden="true" />
          </IconButton>
        ) : null}
        {moreShown ? (
          <div
            ref={moreMenuRef}
            role="menu"
            aria-label={t('notebookToolbar.more')}
            data-testid="notebook-toolbar-more-menu"
            className="notebook-toolbar-menu"
          >
            {menuGroups.map((group, index) => (
              <Fragment key={group[0]!.testId}>
                {index > 0 ? <div role="separator" className="notebook-toolbar-menu-rule" /> : null}
                {group.map(action => (
                  <MenuAction key={action.testId} action={action} close={closeMore} />
                ))}
              </Fragment>
            ))}
            {kernelInMenu ? (
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                disabled={exportDisabled}
                onClick={() => {
                  setMoreOpen(false);
                  setExportMenuOpen(true);
                }}
                data-testid="notebook-toolbar-export"
                className="notebook-toolbar-menu-item"
              >
                {t('notebook.toolbar.export')}
              </button>
            ) : null}
          </div>
        ) : null}
        {exportMenu}
      </div>
      {step === 'stacked' ? <span className="notebook-toolbar-break" aria-hidden="true" /> : null}
      <NotebookStaleNotice staleCount={staleCount} disabled={disabled} onRefresh={handleRefreshStale} />
      <div className="notebook-toolbar-shortcuts relative flex-none" ref={shortcutsAnchorRef}>
        <IconButton
          onClick={() => setShortcutsOpen(open => !open)}
          aria-expanded={shortcutsOpen}
          aria-haspopup="dialog"
          active={shortcutsOpen}
          tooltip={t('notebook.command.shortcutsTitle')}
          tooltipSide="bottom"
          data-testid="notebook-toolbar-shortcuts"
        >
          <Keyboard size={ICON_GLYPH.md} aria-hidden="true" />
        </IconButton>
        {shortcutsOpen ? (
          <div
            role="dialog"
            aria-label={t('notebook.command.shortcutsTitle')}
            data-testid="notebook-shortcuts-legend"
            className="notebook-toolbar-menu notebook-toolbar-legend"
          >
            <p className="mb-2 text-eyebrow font-semibold uppercase tracking-wider text-muted">
              {t('notebook.command.shortcutsTitle')}
            </p>
            <ul className="grid gap-1.5">
              {NOTEBOOK_SHORTCUT_HINTS.map(({ keys, labelKey }) => (
                <li key={labelKey} className="flex items-center justify-between gap-2 text-caption text-foreground">
                  <span>{t(labelKey)}</span>
                  <span className="flex max-w-full flex-wrap items-center gap-1">
                    {keys.map(cap => (
                      <Kbd key={cap}>{cap}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function InlineAction({ action }: { action: ToolbarAction }) {
  return (
    <button
      type="button"
      onClick={action.onSelect}
      disabled={action.disabled}
      title={action.title}
      data-testid={action.testId}
      className="notebook-toolbar-button focus-ring"
    >
      {action.icon}
      {action.label}
    </button>
  );
}

function MenuAction({ action, close }: { action: ToolbarAction; close: () => void }) {
  return (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          close();
          action.onSelect();
        }}
        disabled={action.disabled}
        title={action.title}
        data-testid={action.testId}
        className="notebook-toolbar-menu-item"
      >
        {action.label}
      </button>
  );
}
