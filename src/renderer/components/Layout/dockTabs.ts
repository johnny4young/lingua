import type { BottomPanelTab } from '../../stores/uiStore';

export type DockTabId = BottomPanelTab;

export type DockTabAvailability = Readonly<Record<Exclude<DockTabId, 'console'>, boolean>>;

/** Board order. Console always shows; every other tab appears once it applies. */
const DOCK_TAB_ORDER: readonly DockTabId[] = [
  'console',
  'stdin',
  'compare',
  'variables',
  'project-terminal',
  'tests',
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
