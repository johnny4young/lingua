import { useUIStore } from '../stores/uiStore';

/** Compare is a dock tab: it is on when the dock is open on it. */
export function isCompareDockOpen(state = useUIStore.getState()): boolean {
  return state.consoleVisible && state.activeBottomPanel === 'compare';
}

/** Opens Compare, or returns the dock to Console when Compare is showing. Returns the new state. */
export function toggleCompareDock(): boolean {
  const ui = useUIStore.getState();
  const open = isCompareDockOpen(ui);
  ui.openBottomPanel(open ? 'console' : 'compare');
  return !open;
}
