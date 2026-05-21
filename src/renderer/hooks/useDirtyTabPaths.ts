import { useMemo } from 'react';
import { useEditorStore } from '../stores/editorStore';

/**
 * RL-024 Slice 1 — tree dirty dot helper.
 *
 * Returns a set of `rootId::relativePath` keys for every open tab
 * that has unsaved edits. `FileTree` calls this hook ONCE at the
 * tree root and threads the resulting `Set<string>` down to each
 * `FileTreeNode` via prop — never call it per node, because each
 * call subscribes the component to `editorStore.tabs` and
 * `editorStore.tabs` is a fresh array reference on every keystroke,
 * so N nodes calling this hook means N re-renders per character.
 *
 * Keying by capability id rather than absolute path makes the match
 * exact across platforms (Windows backslashes vs. POSIX slashes
 * cannot collide here).
 */
export function useDirtyTabPaths(): Set<string> {
  // Subscribe to the tabs slice. The selector returns a JS array, so
  // Zustand's default referential comparison only re-fires when the
  // array reference changes — which happens whenever a tab is added,
  // removed, or its `isDirty` flips (every editor mutation creates a
  // fresh `tabs` array in this store).
  const tabs = useEditorStore((state) => state.tabs);

  return useMemo(() => {
    const out = new Set<string>();
    for (const tab of tabs) {
      if (!tab.isDirty) continue;
      if (!tab.rootId || !tab.relativePath) continue;
      out.add(`${tab.rootId}::${tab.relativePath}`);
    }
    return out;
  }, [tabs]);
}

/**
 * Pure helper used by `FileTreeNode` to compose the same key
 * `useDirtyTabPaths()` indexes by. Co-locating the key shape with
 * the hook keeps the encoding in one place — change it once, both
 * sides update.
 */
export function dirtyTabKey(rootId: string, relativePath: string): string {
  return `${rootId}::${relativePath}`;
}
