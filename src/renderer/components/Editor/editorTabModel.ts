import type { FileTab } from '../../types';
import { gitStatusSuppressedByMagicComment } from '../../utils/magicComments';

const VISIBLE_TAB_CAP = 5;

export type EditorTabSummary = Pick<
  FileTab,
  | 'id'
  | 'name'
  | 'language'
  | 'isDirty'
  | 'filePath'
  | 'kind'
  | 'executionState'
  | 'parseError'
> & {
  readonly gitStatusSuppressed: boolean;
};

/**
 * P3 — encode only fields rendered by the tab strip. Zustand's `useShallow`
 * compares array entries with `Object.is`; value-equal strings therefore let
 * content-only store writes short-circuit before React renders. The one
 * content-derived signal the strip owns — the git status magic-comment opt-out
 * — is reduced to a boolean instead of forwarding the whole buffer.
 */
export function encodeEditorTab(tab: FileTab): string {
  return JSON.stringify([
    tab.id,
    tab.name,
    tab.language,
    tab.isDirty,
    tab.filePath ?? null,
    tab.kind ?? null,
    tab.executionState ?? null,
    tab.parseError ?? null,
    gitStatusSuppressedByMagicComment(tab.language, tab.content),
  ]);
}

export function decodeEditorTab(encoded: string): EditorTabSummary {
  const [
    id,
    name,
    language,
    isDirty,
    filePath,
    kind,
    executionState,
    parseError,
    gitStatusSuppressed,
  ] = JSON.parse(encoded) as [
    FileTab['id'],
    FileTab['name'],
    FileTab['language'],
    FileTab['isDirty'],
    FileTab['filePath'] | null,
    FileTab['kind'] | null,
    FileTab['executionState'] | null,
    FileTab['parseError'] | null,
    boolean,
  ];
  return {
    id,
    name,
    language,
    isDirty,
    ...(filePath === null ? {} : { filePath }),
    ...(kind === null ? {} : { kind }),
    ...(executionState === null ? {} : { executionState }),
    parseError,
    gitStatusSuppressed,
  };
}

/**
 * Pick the tabs that stay in the strip (the rest collapse into the `+N`
 * overflow). The handoff caps the strip at five, but a priority set
 * (every kind-bearing workspace/notebook tab + the active tab) is always
 * kept visible; remaining slots fill with code tabs in original order so
 * the strip never reshuffles. Extracted to module scope so the component
 * holds it as a `const` the arrow-key handler can safely close over.
 */
export function computeVisibleTabs(
  tabs: readonly EditorTabSummary[],
  activeTabId: string | null
): EditorTabSummary[] {
  if (tabs.length <= VISIBLE_TAB_CAP) return [...tabs];
  const isPriority = (tab: EditorTabSummary) =>
    tab.id === activeTabId ||
    tab.kind === 'sql' ||
    tab.kind === 'http' ||
    tab.kind === 'notebook' ||
    tab.kind === 'utilities';
  const pinnedIds = new Set(tabs.filter(isPriority).map(tab => tab.id));
  // If the priority set alone exceeds the cap, keep all of it — dropping a
  // workspace tab or the active tab would be worse than a slightly longer strip.
  const remainingSlots = Math.max(0, VISIBLE_TAB_CAP - pinnedIds.size);
  let filled = 0;
  return tabs.filter(tab => {
    if (pinnedIds.has(tab.id)) return true;
    if (filled < remainingSlots) {
      filled += 1;
      return true;
    }
    return false;
  });
}
