import type { EditorState, FileTab } from '../types';

/**
 * RL-128 fold F — derived active-tab selectors, extracted verbatim from
 * `editorStore.ts`. Pure functions over `EditorState`; co-located so every
 * consumer (and the store assembly that re-exports them) inherits a single
 * active-tab derivation seam instead of re-introducing inline
 * `tabs.find(... === activeTabId)` lookups.
 */

/**
 * RL-121 — derived active-tab selector. Returns the `FileTab` whose id
 * matches `state.activeTabId`, or `null` when there is no active tab
 * (empty workspace) or the id points at a since-removed tab.
 *
 * Referential-stability contract: this returns the EXISTING tab object
 * reference held in `state.tabs` — it never allocates a new object. A
 * consumer that subscribes through `useActiveTab()` therefore does not
 * re-render when an UNRELATED tab mutates, as long as the active tab's
 * own object identity is preserved by the mutating action. Treat the
 * returned tab as read-only; mutate tab state through store actions,
 * never the returned reference.
 */
export function getActiveTab(state: EditorState): FileTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

/**
 * RL-121 fold E — index of the active tab within `state.tabs`, or `-1`
 * when there is no active tab. Co-located with `getActiveTab` so the
 * PanelChipsRow memoization (RL-122) and the editorStore split (RL-128)
 * inherit a single active-tab derivation seam instead of re-introducing
 * inline `tabs.findIndex(... === activeTabId)`.
 */
export function getActiveTabIndex(state: EditorState): number {
  return state.activeTabId === null
    ? -1
    : state.tabs.findIndex((tab) => tab.id === state.activeTabId);
}
