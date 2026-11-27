import { writePersisted } from '../../stores/uiStore';
import type { DockTabId } from './dockTabs';

const DOCK_TAB_USE_KEY = 'lingua-ui:dock-tab-use';

export type DockTabUse = Readonly<Partial<Record<DockTabId, number>>>;

/** How often each dock tab was picked from the row or More; malformed entries read as unused. */
export function readDockTabUse(): DockTabUse {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DOCK_TAB_USE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => Number.isSafeInteger(value) && (value as number) > 0)
    );
  } catch {
    return {};
  }
}

export function recordDockTabUse(use: DockTabUse, id: DockTabId): DockTabUse {
  const next = { ...use, [id]: (use[id] ?? 0) + 1 };
  writePersisted(DOCK_TAB_USE_KEY, next);
  return next;
}

/** Most used first; ties keep the given order. */
export function rankDockTabs(ids: readonly DockTabId[], use: DockTabUse): DockTabId[] {
  return ids
    .map((id, index) => ({ id, index }))
    .sort((a, b) => (use[b.id] ?? 0) - (use[a.id] ?? 0) || a.index - b.index)
    .map(entry => entry.id);
}
