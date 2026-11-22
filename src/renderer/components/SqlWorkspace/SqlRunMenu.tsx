import { ListOrdered, Loader2, Play, ScanSearch, TextSelect, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  currentShortcutDisplayPlatform,
  formatShortcutCombo,
  type ShortcutCombo,
} from '../../data/keyboardShortcuts';
import { CommandBarVerb } from '../Chrome/CommandBarSlot';

export type SqlRunMenuMode = 'statement' | 'selection' | 'all' | 'explain';

const COMBOS: Record<Exclude<SqlRunMenuMode, 'explain'> | 'cancel', ShortcutCombo> = {
  statement: { tokens: ['Mod', 'Enter'] },
  selection: { tokens: ['Mod', 'Alt', 'Enter'] },
  all: { tokens: ['Mod', 'Shift', 'Enter'] },
  cancel: { tokens: ['Mod', '.'] },
};

const ITEMS: ReadonlyArray<{ mode: SqlRunMenuMode; labelKey: string; Icon: LucideIcon }> = [
  { mode: 'statement', labelKey: 'sqlWorkspace.run.statement', Icon: Play },
  { mode: 'selection', labelKey: 'sqlWorkspace.run.selection', Icon: TextSelect },
  { mode: 'all', labelKey: 'sqlWorkspace.run.all', Icon: ListOrdered },
  { mode: 'explain', labelKey: 'sqlWorkspace.run.explain', Icon: ScanSearch },
];

const comboLabel = (combo: ShortcutCombo) => formatShortcutCombo(combo, currentShortcutDisplayPlatform());

/** Split Run: the verb runs the statement under the cursor; the menu holds the other modes. */
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
  const items = useMemo(
    () =>
      ITEMS.map(({ mode, labelKey, Icon }) => ({
        id: mode,
        label: t(labelKey),
        icon: <Icon size={13} />,
        testId: `sql-run-menu-${mode}`,
        disabled: mode === 'selection' && !hasSelection,
        ...(mode === 'explain' ? {} : { shortcut: comboLabel(COMBOS[mode]) }),
        onSelect: () => onRun(mode),
      })),
    [t, hasSelection, onRun]
  );
  if (isExecuting) {
    return (
      <CommandBarVerb
        running
        label={t('sqlWorkspace.run.cancel')}
        icon={<Loader2 size={11} className="animate-spin" />}
        shortcut={comboLabel(COMBOS.cancel)}
        onClick={onCancel}
        testId="sql-query-editor-cancel"
      />
    );
  }
  return (
    <CommandBarVerb
      label={t('sqlWorkspace.run.statement')}
      icon={<Play size={11} />}
      shortcut={comboLabel(COMBOS.statement)}
      onClick={() => onRun('statement')}
      disabled={disabled}
      title={t('sqlWorkspace.run.statement')}
      testId="sql-query-editor-run"
      menu={{
        label: t('sqlWorkspace.run.more'),
        testId: 'sql-query-editor-run-menu',
        listTestId: 'sql-run-menu',
        disabled,
        items,
      }}
    />
  );
}
