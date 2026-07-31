import {
  getGoLspAdapter,
  isGoLspAvailable,
  loadGoLspAdapter,
} from '../languageIntelligence/goAdapterSingleton';
import { useGoLanguageStore } from '../stores/goLanguageStore';
import { useLspDocumentSync, useLspLifecycle } from './useLspLifecycle';

/**
 * implementation — gopls lifecycle wiring. Thin facade around
 * `useLspLifecycle` matching the rust-analyzer counterpart in
 * `useRustLspLifecycle.ts`.
 */

interface ActiveGoTab {
  id: string;
  language: string;
  content: string;
}

interface EditorWithModel {
  getModel: () => { uri: { toString: () => string }; getLanguageId?: () => string } | null;
}

function getGoBridge() {
  return window.lingua.lsp.go;
}

export function useGoLspLifecycle(): void {
  useLspLifecycle({
    language: 'go',
    diagnosticSource: 'gopls',
    toastMessageKey: 'languageIntelligence.go.toast.ready',
    store: useGoLanguageStore,
    isAvailable: isGoLspAvailable,
    loadAdapter: loadGoLspAdapter,
    adapterLoadFailedMessageKey: 'languageIntelligence.go.toast.adapterLoadFailed',
    getBridge: getGoBridge,
  });
}

export function useGoLspDocumentSync(
  editor: EditorWithModel | null,
  activeTab: ActiveGoTab | null | undefined
): void {
  useLspDocumentSync(editor, activeTab, {
    language: 'go',
    store: useGoLanguageStore,
    getAdapter: getGoLspAdapter,
    loadAdapter: loadGoLspAdapter,
  });
}
