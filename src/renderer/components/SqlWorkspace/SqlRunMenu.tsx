import { ChevronDown, Loader2, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  currentShortcutDisplayPlatform,
  formatShortcutCombo,
  type ShortcutCombo,
} from '../../data/keyboardShortcuts';
import { cn } from '../../utils/cn';
import { useFloatingPosition } from './useFloatingPosition';

export type SqlRunMenuMode = 'statement' | 'selection' | 'all' | 'explain';

const COMBOS: Record<Exclude<SqlRunMenuMode, 'explain'> | 'cancel', ShortcutCombo> = {
  statement: { tokens: ['Mod', 'Enter'] },
  selection: { tokens: ['Mod', 'Alt', 'Enter'] },
  all: { tokens: ['Mod', 'Shift', 'Enter'] },
  cancel: { tokens: ['Mod', '.'] },
};

const ITEMS: ReadonlyArray<{ mode: SqlRunMenuMode; labelKey: string }> = [
  { mode: 'statement', labelKey: 'sqlWorkspace.run.statement' },
  { mode: 'selection', labelKey: 'sqlWorkspace.run.selection' },
  { mode: 'all', labelKey: 'sqlWorkspace.run.all' },
  { mode: 'explain', labelKey: 'sqlWorkspace.run.explain' },
];

const comboLabel = (combo: ShortcutCombo) => formatShortcutCombo(combo, currentShortcutDisplayPlatform());

const BUTTON =
  'inline-flex h-7 items-center gap-1.5 border border-accent bg-accent px-2.5 text-body-sm font-semibold text-fg-on-accent transition-colors hover:border-accent-hover hover:bg-accent-hover active:bg-accent-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:cursor-not-allowed disabled:opacity-40';

/** Split Run: the main button runs the statement under the cursor; the menu holds the other modes. */
export function SqlRunMenu({
  onRun,
  onCancel,
  isExecuting,
  disabled,
  hasSelection,
}: {
  onRun: (mode: SqlRunMenuMode) => void;
  onCancel: () => void;
  isExecuting: boolean;
  disabled: boolean;
  hasSelection: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const position = useFloatingPosition(containerRef, open, 'below');

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (isExecuting) {
    return (
      <button
        type="button"
        onClick={onCancel}
        data-testid="sql-query-editor-cancel"
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-error-border bg-error-bg px-2.5 text-body-sm font-semibold text-error-fg transition-colors hover:border-error-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Loader2 size={11} aria-hidden="true" className="animate-spin" />
        <span>{t('sqlWorkspace.run.cancel')}</span>
        <span className="hidden font-mono text-eyebrow opacity-80 sm:inline">{comboLabel(COMBOS.cancel)}</span>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => onRun('statement')}
        disabled={disabled}
        data-testid="sql-query-editor-run"
        aria-label={t('sqlWorkspace.run.statement')}
        title={t('sqlWorkspace.run.statement')}
        className={cn(BUTTON, 'rounded-l-md')}
      >
        <Play size={11} aria-hidden="true" />
        <span>{t('sqlWorkspace.editor.run')}</span>
        <span className="ml-1 hidden font-mono text-eyebrow opacity-80 sm:inline">
          {comboLabel(COMBOS.statement)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        data-testid="sql-query-editor-run-menu"
        aria-label={t('sqlWorkspace.run.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(BUTTON, 'rounded-r-md border-l-fg-on-accent/30 px-1.5')}
      >
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          data-testid="sql-run-menu"
          style={position}
          className="z-50 min-w-[220px] rounded-md border border-border-default bg-bg-panel p-1 shadow-lg"
        >
          {ITEMS.map(({ mode, labelKey }) => {
            const itemDisabled = mode === 'selection' && !hasSelection;
            return (
              <button
                key={mode}
                type="button"
                role="menuitem"
                disabled={itemDisabled}
                data-testid={`sql-run-menu-${mode}`}
                onClick={() => {
                  setOpen(false);
                  onRun(mode);
                }}
                className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-body-sm text-fg-base hover:bg-bg-panel-alt focus-visible:bg-bg-panel-alt focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
                {mode !== 'explain' ? (
                  <kbd className="shrink-0 font-mono text-micro text-fg-subtle">{comboLabel(COMBOS[mode])}</kbd>
                ) : null}
              </button>
            );
          })}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
