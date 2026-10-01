import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { pathToFileUri } from '../utils/filePath';

interface DocumentAdapter {
  openDocument(uri: string, content: string): void;
  closeDocument(uri: string): void;
}

/** Project buffers stay open while their tabs exist, including inactive dirty siblings. */
export function useLspProjectDocuments(
  language: string,
  available: boolean,
  getAdapter: () => DocumentAdapter | null,
  loadAdapter: () => Promise<DocumentAdapter | null>,
  debounceMs: number
): void {
  const rootId = useProjectStore(state => state.currentProject?.rootId);
  const tabs = useEditorStore(state => state.tabs);
  const opened = useRef(new Set<string>());

  useEffect(() => {
    const buffers =
      available && rootId
        ? tabs.filter(
            tab =>
              tab.language === language && tab.rootId === rootId && tab.filePath && tab.relativePath
          )
        : [];
    const retained = new Set(buffers.map(tab => pathToFileUri(tab.filePath!)));
    for (const uri of opened.current) {
      if (!retained.has(uri)) {
        getAdapter()?.closeDocument(uri);
        opened.current.delete(uri);
      }
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      if (!buffers.length) return;
      void loadAdapter()
        .then(adapter => {
          if (disposed || !adapter) return;
          for (const tab of buffers) {
            const uri = pathToFileUri(tab.filePath!);
            adapter.openDocument(uri, tab.content);
            opened.current.add(uri);
          }
        })
        .catch(() => {
          /* Lifecycle owns adapter-load errors. */
        });
    }, debounceMs);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [tabs, rootId, language, available, getAdapter, loadAdapter, debounceMs]);

  useEffect(
    () => () => {
      for (const uri of opened.current) getAdapter()?.closeDocument(uri);
      opened.current.clear();
    },
    [getAdapter]
  );
}
