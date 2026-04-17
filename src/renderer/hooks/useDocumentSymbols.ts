import { useEffect, useRef, useState } from 'react';
import { loadNavigationBarItems } from '../monaco';
import type { FileTab } from '../types';
import {
  flattenNavigationItems,
  supportsSymbolNavigation,
  type NavigationBarItem,
  type SymbolEntry,
} from '../utils/symbolNavigation';

export type SymbolLoadStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'empty';

export interface SymbolLoadResult {
  status: SymbolLoadStatus;
  entries: SymbolEntry[];
}

/**
 * Lazily-imported Monaco module accessor. We intentionally avoid a top-level
 * import so the hook stays cheap to test (the full monaco module imports
 * editor.all.js, which is heavy).
 */
async function resolveMonaco() {
  return import('monaco-editor/esm/vs/editor/editor.api.js');
}

/**
 * Map a zero-based character offset into a Monaco model into a 1-indexed
 * line/column pair. Extracted so the symbol flattener stays pure and the
 * hook owns the imperative model lookup.
 */
function makePositionResolver(model: {
  getPositionAt: (offset: number) => { lineNumber: number; column: number };
}) {
  return (offset: number) => {
    const position = model.getPositionAt(offset);
    return { lineNumber: position.lineNumber, column: position.column };
  };
}

/**
 * Load a flat, navigable symbol list for the active tab. Re-runs whenever
 * the tab id or its content changes so newly-typed declarations surface
 * without the user having to re-open the overlay.
 */
export function useDocumentSymbols(
  activeTab: FileTab | null,
  enabled: boolean
): SymbolLoadResult {
  const [state, setState] = useState<SymbolLoadResult>({ status: 'idle', entries: [] });
  // Tracks the last tab id we loaded symbols for so we can distinguish
  // "same tab, content edit" (keep entries while refreshing for smoother
  // UX) from "different tab" (clear entries so the user never sees another
  // file's symbols tagged as loading).
  const lastTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', entries: [] });
      lastTabIdRef.current = null;
      return;
    }

    if (!activeTab) {
      setState({ status: 'unsupported', entries: [] });
      lastTabIdRef.current = null;
      return;
    }

    if (!supportsSymbolNavigation(activeTab.language)) {
      setState({ status: 'unsupported', entries: [] });
      lastTabIdRef.current = activeTab.id;
      return;
    }

    const tabChanged = lastTabIdRef.current !== activeTab.id;
    lastTabIdRef.current = activeTab.id;

    let cancelled = false;
    setState((previous) => ({
      status: 'loading',
      // Cross-tab transitions wipe entries so the user never sees stale
      // symbols from the previous file under a "Loading" label. In-place
      // content edits keep entries visible for a gentler refresh feel.
      entries: tabChanged ? [] : previous.entries,
    }));

    async function loadSymbols() {
      try {
        const monaco = await resolveMonaco();
        // Target the model currently mounted in the visible editor. This is
        // more robust than iterating `getModels()` by language id: if a
        // future refactor gives each tab its own model path the same call
        // keeps returning the on-screen model and the symbols stay in sync
        // with what the user actually sees.
        const mountedEditor = monaco.editor.getEditors()[0];
        const model = mountedEditor?.getModel() ?? null;
        const expectedLanguage = activeTab!.language;
        if (!model || model.getLanguageId() !== expectedLanguage || cancelled) {
          if (!cancelled) setState({ status: 'empty', entries: [] });
          return;
        }

        const items = (await loadNavigationBarItems(model)) as
          | NavigationBarItem[]
          | null;
        if (cancelled) return;
        if (!items) {
          setState({ status: 'empty', entries: [] });
          return;
        }

        const entries = flattenNavigationItems(items, makePositionResolver(model));
        setState({
          status: entries.length === 0 ? 'empty' : 'ready',
          entries,
        });
      } catch {
        if (!cancelled) setState({ status: 'empty', entries: [] });
      }
    }

    void loadSymbols();

    return () => {
      cancelled = true;
    };
  }, [enabled, activeTab]);

  return state;
}
