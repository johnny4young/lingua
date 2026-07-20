import {
  getRustLspAdapter,
  isRustLspAvailable,
} from '../languageIntelligence/rustAdapterSingleton';
import { useRustLanguageStore } from '../stores/rustLanguageStore';
import {
  LSP_DOCUMENT_SYNC_DEBOUNCE_MS,
  useLspDocumentSync,
  useLspLifecycle,
} from './useLspLifecycle';

/**
 * implementation — rust-analyzer lifecycle wiring. implementation lifted the
 * effect bodies into `useLspLifecycle` so the Go path can reuse them
 * byte-identically. This file stays as the rust-specific facade so
 * every callsite (`useRustLspLifecycle()` in `App.tsx`,
 * `useRustLspDocumentSync(...)` in `CodeEditor.tsx`) keeps working
 * without churn.
 */

export const RUST_LSP_DOCUMENT_SYNC_DEBOUNCE_MS = LSP_DOCUMENT_SYNC_DEBOUNCE_MS;

interface ActiveRustTab {
  id: string;
  language: string;
  content: string;
}

interface EditorWithModel {
  getModel: () => { uri: { toString: () => string }; getLanguageId?: () => string } | null;
}

function getRustBridge() {
  return window.lingua.lsp.rust;
}

export function useRustLspLifecycle(): void {
  useLspLifecycle({
    language: 'rust',
    diagnosticSource: 'rust-analyzer',
    toastMessageKey: 'languageIntelligence.rust.toast.ready',
    store: useRustLanguageStore,
    isAvailable: isRustLspAvailable,
    getAdapter: getRustLspAdapter,
    getBridge: getRustBridge,
  });
}

export function useRustLspDocumentSync(
  editor: EditorWithModel | null,
  activeTab: ActiveRustTab | null | undefined
): void {
  useLspDocumentSync(editor, activeTab, {
    language: 'rust',
    store: useRustLanguageStore,
    getAdapter: getRustLspAdapter,
  });
}
