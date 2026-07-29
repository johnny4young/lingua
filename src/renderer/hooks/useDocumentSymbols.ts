import { useEffect, useState } from 'react';
import type { FileTab } from '../types';
import {
  flattenNavigationTree,
  supportsSymbolNavigation,
  type SymbolEntry,
} from '../utils/symbolNavigation';

export type SymbolLoadStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'empty';

export interface SymbolLoadResult {
  status: SymbolLoadStatus;
  entries: SymbolEntry[];
}

interface ResolvedSymbolLoad {
  tabId: string;
  language: FileTab['language'];
  content: string;
  result: SymbolLoadResult;
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
 * Same reason, second module: `../monaco` pulls the editor API, the five
 * `?worker` bundles and `@monaco-editor/react` with it. This hook is reached
 * from `<AppOverlays>` — which App renders unconditionally — so a top-level
 * import here parks the whole Monaco chunk in the initial graph even for a
 * visitor who never opens Go to Symbol. Keeping it dynamic is what makes the
 * comment above true rather than aspirational.
 */
async function resolveNavigationTree() {
  const { loadNavigationTree } = await import('../monaco');
  return loadNavigationTree;
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
  const [resolvedLoad, setResolvedLoad] = useState<ResolvedSymbolLoad | null>(null);
  const supported =
    activeTab !== null && supportsSymbolNavigation(activeTab.language);
  const requestIsResolved =
    enabled &&
    supported &&
    resolvedLoad?.tabId === activeTab.id &&
    resolvedLoad.language === activeTab.language &&
    resolvedLoad.content === activeTab.content;

  let visibleResult: SymbolLoadResult;
  if (!enabled) {
    visibleResult = { status: 'idle', entries: [] };
  } else if (!activeTab || !supported) {
    visibleResult = { status: 'unsupported', entries: [] };
  } else if (requestIsResolved) {
    visibleResult = resolvedLoad.result;
  } else {
    const refreshingSameDocument =
      resolvedLoad?.tabId === activeTab.id &&
      resolvedLoad.language === activeTab.language;
    visibleResult = {
      status: 'loading',
      // Cross-tab/language transitions wipe entries so the user never sees
      // stale symbols. Content edits retain the last result while refreshing.
      entries: refreshingSameDocument ? resolvedLoad.result.entries : [],
    };
  }

  useEffect(() => {
    if (!enabled || !activeTab || !supportsSymbolNavigation(activeTab.language)) return;
    const requestedTab = activeTab;

    let cancelled = false;
    const commitResult = (result: SymbolLoadResult) => {
      if (cancelled) return;
      setResolvedLoad({
        tabId: requestedTab.id,
        language: requestedTab.language,
        content: requestedTab.content,
        result,
      });
    };

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
        const expectedLanguage = requestedTab.language;
        if (!model || model.getLanguageId() !== expectedLanguage || cancelled) {
          commitResult({ status: 'empty', entries: [] });
          return;
        }

        const loadNavigationTree = await resolveNavigationTree();
        const tree = await loadNavigationTree(model);
        if (cancelled) return;
        if (!tree) {
          commitResult({ status: 'empty', entries: [] });
          return;
        }

        const entries = flattenNavigationTree(tree, makePositionResolver(model));
        commitResult({
          status: entries.length === 0 ? 'empty' : 'ready',
          entries,
        });
      } catch {
        commitResult({ status: 'empty', entries: [] });
      }
    }

    void loadSymbols();

    return () => {
      cancelled = true;
    };
  }, [enabled, activeTab]);

  return visibleResult;
}
