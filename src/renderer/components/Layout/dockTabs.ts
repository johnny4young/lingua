import type { BottomPanelTab } from '../../stores/uiStore';

export type DockTabId = BottomPanelTab;

export type DockTabAvailability = Readonly<Record<Exclude<DockTabId, 'console'>, boolean>>;

/** Board order. Console always shows; every other tab appears once it applies. */
const DOCK_TAB_ORDER: readonly DockTabId[] = [
  'console',
  'stdin',
  'compare',
  'timeline',
  'variables',
  'tests',
  'project-terminal',
  'debugger',
  'browser-preview',
  'dependencies',
  'git-diff',
  'recipe',
];

export function availableDockTabs(availability: DockTabAvailability): DockTabId[] {
  return DOCK_TAB_ORDER.filter(id => id === 'console' || availability[id]);
}

/**
 * The tab whose body the dock shows. A selected tab that stopped applying
 * falls back to Console; a live debugger or browser preview claims a dock
 * the user had hidden.
 */
export function resolveDockTab(
  selected: DockTabId,
  availability: DockTabAvailability,
  dockVisible: boolean
): DockTabId {
  if (!dockVisible) {
    if (availability['browser-preview']) return 'browser-preview';
    if (availability.debugger) return 'debugger';
  }
  return selected === 'console' || availability[selected] ? selected : 'console';
}

/** Tests and Terminal, the tabs that share a wide dock side by side. */
export const isDockSplitTab = (id: DockTabId): id is 'tests' | 'project-terminal' =>
  id === 'tests' || id === 'project-terminal';

/** Dock width from which the pair opens side by side; narrower docks show one tab at a time. */
export const DOCK_SPLIT_MIN_WIDTH = 1100;

/** Whether the dock shows Tests and Terminal side by side: wide, both apply, and one of them is selected. */
export function isDockSplit(shown: DockTabId, availability: DockTabAvailability, wide: boolean): boolean {
  return (
    wide &&
    availability.tests &&
    availability['project-terminal'] &&
    isDockSplitTab(shown)
  );
}
