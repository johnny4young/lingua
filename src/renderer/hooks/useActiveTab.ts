/**
 * internal — React subscription hooks for the active tab.
 *
 * `useActiveTab()` is the single supported way for a renderer component
 * to read the currently-focused `FileTab`. It selects through
 * `getActiveTab` and wraps the result in `useShallow`, so a subscriber
 * only re-renders when the active tab's own shallow-comparable fields
 * change (or when the active tab switches) — NOT when an UNRELATED tab
 * mutates. This removes the O(N·M) re-render fan-out internal targets,
 * where ~15 components each re-derived the active tab inline via
 * `tabs.find(... === activeTabId)` and re-rendered on every `tabs`
 * array mutation, including edits to sibling tabs.
 *
 * Contract: treat the returned tab as read-only. Mutate tab state
 * through `editorStore` actions, never through the returned reference.
 */
import { useShallow } from 'zustand/react/shallow';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import type { FileTab } from '../types';

export function useActiveTab(): FileTab | null {
  return useEditorStore(useShallow(getActiveTab));
}

/**
 * implementation — subscribe to just the active tab's id. Use this in
 * components that only need to compare identity (tab-strip highlight,
 * "is this row the active tab?") so they do not re-render when the
 * active tab's CONTENT changes — only when the selection itself moves.
 */
export function useActiveTabId(): string | null {
  return useEditorStore((state) => state.activeTabId);
}
