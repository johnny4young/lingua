import type { EditorState } from '../types';
import { useRecipeStore } from './recipeStore';
import type { EditorSet } from './editorStoreContext';

/**
 * implementation — per-tab content-write action factory for the editor store.
 *
 * Bundles the buffer writers (`updateContent`, `setTabContentFromDisk`), the
 * execution-state setter, the recipe-binding clear, and the one-shot
 * extended-timeout override. The runtime/workflow mode + capability-toggle
 * setters live in `editorModeActions`. Every action here is a pure `set`
 * update (plus `clearRecipeBinding`'s recipeStore unbind), so the factory only
 * needs zustand `set`. Extracted verbatim from `editorStore.ts`.
 */
export function createContentActions(
  set: EditorSet
): Pick<
  EditorState,
  | 'updateContent'
  | 'setTabContentFromDisk'
  | 'setTabExecutionState'
  | 'clearRecipeBinding'
  | 'setTabNextRunTimeoutOverride'
> {
  return {
    updateContent: (id, content) =>
      set((state) => ({
        // internal — clear lifecycle markers when the user edits the buffer.
        // A stale `error` dot or `running` state would mislead the user
        // about the current code's outcome; reset to `idle` so the next
        // run produces a fresh signal.
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                content,
                isDirty: true,
                executionState: 'idle' as const,
                parseError: null,
              }
            : t
        ),
      })),

    /**
     * implementation — refresh a tab's buffer from disk content WITHOUT
     * marking it dirty. Used by the Replace in files overlay after a
     * successful IPC apply so the tab visually reflects the on-disk
     * change. Unlike `updateContent` (which is the user-edit path),
     * `isDirty` stays false because the disk and the buffer now match.
     * Cmd+Z does NOT restore the previous content — replace-in-files
     * is documented as a non-undoable operation in the confirmation
     * modal copy.
     */
    setTabContentFromDisk: (id: string, content: string) =>
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                content,
                isDirty: false,
                executionState: 'idle' as const,
                parseError: null,
              }
            : t
        ),
      })),

    setTabExecutionState: (id, executionState, parseError = null) =>
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, executionState, parseError } : t
        ),
      })),

    clearRecipeBinding: (id) => {
      set((state) => ({
        tabs: state.tabs.map((t) => {
          if (t.id !== id || t.recipeBindingId === undefined) return t;
          const { recipeBindingId: _drop, ...rest } = t;
          void _drop;
          return rest;
        }),
      }));
      useRecipeStore.getState().unbindRecipe(id);
    },

    setTabNextRunTimeoutOverride: (id, timeoutMs) => {
      set((state) => ({
        tabs: state.tabs.map((t) => {
          if (t.id !== id) return t;
          const isValid =
            typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0;
          if (!isValid) {
            if (t.nextRunTimeoutOverrideMs === undefined) return t;
            const { nextRunTimeoutOverrideMs: _drop, ...rest } = t;
            void _drop;
            return rest;
          }
          return { ...t, nextRunTimeoutOverrideMs: timeoutMs };
        }),
      }));
    },
  };
}
