import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Clock3, Eye, GitCompare, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import {
  comparableSnapshotCountFor,
  scopeSnapshotVariableCountFor,
  useResultStore,
} from '../../stores/resultStore';
import { executionModeForLanguage } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { syncVariableInspectorSurfaceAfterToggle } from '../../utils/variableInspectorSurface';
import { isWorkerRunnerLanguage } from '../../../shared/languageFamilies';

/**
 * internal ownership split — the editor chips row moved out of
 * `AppLayout.tsx` (shell size budget) into its own feature file. Verbatim
 * extraction: descriptors, the memoized chip, and the row itself.
 */

function countStdinLines(buffer: string | undefined): number {
  if (!buffer) return 0;
  const lines = buffer.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/**
 * internal — descriptor for one context chip in {@link PanelChipsRow}. The
 * row builds these in a memoized array; {@link PanelChip} renders one.
 * `onClick` carries the per-chip toggle behavior so the renderer stays a
 * pure presentation component.
 */
interface PanelChipDescriptor {
  readonly id: 'stdin' | 'history' | 'compare' | 'variables';
  readonly icon: LucideIcon;
  readonly label: string;
  readonly badge: string | null;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly title: string;
  readonly onClick: () => void;
}

/**
 * implementation — single context chip, extracted and `memo`-wrapped so a
 * `PanelChipsRow` re-render does not re-render a chip whose descriptor is
 * referentially unchanged.
 */
const PanelChip = memo(function PanelChip({ chip }: { chip: PanelChipDescriptor }) {
  const Icon = chip.icon;
  return (
    <button
      type="button"
      data-testid={`panel-chip-${chip.id}`}
      className={cn(
        'panel-chip',
        chip.active && 'panel-chip-active',
        chip.disabled && 'cursor-not-allowed opacity-45'
      )}
      aria-pressed={chip.active}
      disabled={chip.disabled}
      title={chip.title}
      onClick={chip.onClick}
    >
      <Icon size={11} aria-hidden />
      <span>{chip.label}</span>
      {chip.badge ? <span className="panel-chip-badge">{chip.badge}</span> : null}
    </button>
  );
});

/**
 * internal — the chips row subscribes to narrow PRIMITIVE derivations of
 * the active tab (id / language / runtimeMode / stdin line count / the two
 * per-tab toggle flags) instead of the whole `FileTab` through
 * `useActiveTab()`: `content` is a shallow field of the tab object, so a
 * whole-tab subscription re-renders this row on every editor keystroke.
 * The render-count contract lives in
 * `tests/components/panelChipsRowRerender.test.tsx`. `trailing` lets the
 * shell append workspace-scoped pills (Utilities hint + tool counter) so
 * full-screen workspace tabs share this single header row instead of
 * adding one.
 */
export function PanelChipsRow({ trailing }: { trailing?: ReactNode } = {}) {
  const { t } = useTranslation();
  const activeTabId = useEditorStore(state => getActiveTab(state)?.id ?? null);
  const activeTabLanguage = useEditorStore(state => getActiveTab(state)?.language ?? null);
  const activeTabRuntimeMode = useEditorStore(state => getActiveTab(state)?.runtimeMode ?? null);
  const stdinLineCount = useEditorStore(state =>
    countStdinLines(getActiveTab(state)?.stdinBuffer)
  );
  const compareEnabled = useEditorStore(
    state => getActiveTab(state)?.compareWithSnapshotEnabled === true
  );
  const variableInspectorEnabled = useEditorStore(
    state => getActiveTab(state)?.variableInspectorEnabled === true
  );
  const setTabCompareEnabled = useEditorStore(state => state.setTabCompareEnabled);
  const setTabVariableInspectorEnabled = useEditorStore(
    state => state.setTabVariableInspectorEnabled
  );
  const showStdinPanel = useSettingsStore(state => state.showStdinPanel);
  const variableInspectorSurface = useSettingsStore(state => state.variableInspectorSurface);
  const activeBottomPanel = useUIStore(state => state.activeBottomPanel);
  const consoleVisible = useUIStore(state => state.consoleVisible);
  const openBottomPanel = useUIStore(state => state.openBottomPanel);
  const setConsoleVisible = useUIStore(state => state.setConsoleVisible);
  // internal — subscribe to identity-stable PRIMITIVE derivations instead
  // of the raw `snapshotRing` array + `scopeSnapshot` object, so this row
  // re-renders only when the comparator count or the captured variable
  // count for the active language actually changes — not on every run
  // that replaces those references.
  const comparableSnapshotCount = useResultStore(state =>
    comparableSnapshotCountFor(state, activeTabLanguage ?? undefined)
  );
  const scopeVariableCount = useResultStore(state =>
    scopeSnapshotVariableCountFor(state, activeTabLanguage ?? undefined)
  );

  // internal — build the chip descriptors in a memo keyed on the real
  // inputs (active tab, the two snapshot derivations, panel + settings
  // state, and the store actions). Returns [] when there is no active
  // tab so the hook order stays stable across the early return below.
  const chips = useMemo<PanelChipDescriptor[]>(() => {
    if (!activeTabId || !activeTabLanguage) return [];
    const executionMode = executionModeForLanguage(activeTabLanguage);
    const stdinAvailable =
      showStdinPanel &&
      activeTabRuntimeMode !== 'browser-preview' &&
      isWorkerRunnerLanguage(activeTabLanguage);
    const compareAvailable = executionMode === 'run' && comparableSnapshotCount > 0;
    const variableAvailable =
      executionMode === 'run' &&
      activeTabRuntimeMode !== 'node' &&
      isWorkerRunnerLanguage(activeTabLanguage) &&
      scopeVariableCount !== null;
    return [
      {
        id: 'stdin',
        icon: MessageSquare,
        label: t('panelChips.stdin'),
        badge: stdinLineCount > 0 ? String(stdinLineCount) : null,
        active: activeBottomPanel === 'stdin' && consoleVisible,
        disabled: !stdinAvailable,
        title: stdinAvailable ? t('panelChips.stdin.tooltip') : t('panelChips.stdin.disabled'),
        onClick: () => {
          if (activeBottomPanel === 'stdin' && consoleVisible) {
            setConsoleVisible(false);
          } else {
            openBottomPanel('stdin');
          }
        },
      },
      {
        id: 'history',
        icon: Clock3,
        label: t('panelChips.history'),
        badge: null,
        active: activeBottomPanel === 'console' && consoleVisible,
        disabled: false,
        title: t('panelChips.history.tooltip'),
        onClick: () => {
          if (activeBottomPanel === 'console' && consoleVisible) {
            setConsoleVisible(false);
          } else {
            openBottomPanel('console');
          }
        },
      },
      {
        id: 'compare',
        icon: GitCompare,
        label: t('panelChips.compare'),
        badge: compareAvailable ? String(comparableSnapshotCount) : null,
        active: compareEnabled,
        disabled: !compareAvailable,
        title: compareAvailable
          ? t('panelChips.compare.tooltip')
          : t('compare.toggle.tooltipDisabled'),
        onClick: () => setTabCompareEnabled(activeTabId, !compareEnabled),
      },
      {
        id: 'variables',
        icon: Eye,
        label: t('panelChips.variables'),
        badge: variableAvailable ? String(scopeVariableCount ?? 0) : null,
        // implementation — when surface=bottom, active state mirrors the
        // bottom-panel tab selection so clicking the chip when the
        // bottom Variables tab is showing toggles the drawer off.
        active:
          variableInspectorSurface === 'bottom'
            ? activeBottomPanel === 'variables' && consoleVisible
            : variableInspectorEnabled,
        disabled: !variableAvailable,
        title: variableAvailable
          ? t('panelChips.variables.tooltip')
          : t('variableInspector.toggle.tooltipDisabled'),
        onClick: () => {
          // implementation — bottom mode treats the drawer selection as the
          // visible toggle. If the per-tab flag is already true but the drawer
          // is not showing Variables, clicking the inactive chip must open the
          // Variables tab rather than silently turning the feature off.
          const variablesDrawerOpen = activeBottomPanel === 'variables' && consoleVisible;
          const nextEnabled =
            variableInspectorSurface === 'bottom' ? !variablesDrawerOpen : !variableInspectorEnabled;
          setTabVariableInspectorEnabled(activeTabId, nextEnabled);
          syncVariableInspectorSurfaceAfterToggle(nextEnabled);
        },
      },
    ];
  }, [
    t,
    activeTabId,
    activeTabLanguage,
    activeTabRuntimeMode,
    stdinLineCount,
    compareEnabled,
    variableInspectorEnabled,
    comparableSnapshotCount,
    scopeVariableCount,
    showStdinPanel,
    variableInspectorSurface,
    activeBottomPanel,
    consoleVisible,
    openBottomPanel,
    setConsoleVisible,
    setTabCompareEnabled,
    setTabVariableInspectorEnabled,
  ]);

  if (!activeTabId) return null;

  return (
    <div className="panel-chip-row" role="toolbar" aria-label={t('panelChips.ariaLabel')}>
      {chips.map(chip => (
        <PanelChip key={chip.id} chip={chip} />
      ))}
      {trailing ? <div className="ml-1.5 flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
