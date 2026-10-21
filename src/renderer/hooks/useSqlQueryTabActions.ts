import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlHistoryEntryV1 } from '../../shared/sqlHistory';
import { createBlankSqlQuery, type SqlQueryV1 } from '../../shared/sqlWorkspace';
import { admitSqlQueryTab } from '../components/SqlWorkspace/sqlQueryTabBudget';
import { useUIStore } from '../stores/uiStore';
import { useWorkspaceSqlStore } from '../stores/workspaceSqlStore';
import { useTelemetry } from './useTelemetry';

export interface SqlSaveDialogState {
  /** The query the dialog was opened for; it closes when that tab is no longer active. */
  queryId: string;
  mode: 'save' | 'saveAs';
  /** Close the tab once saved (the Save choice when closing a scratch). */
  closeAfter?: boolean;
}

/** The next free `Scratch N` number. */
function nextScratchNumber(queries: ReadonlyArray<SqlQueryV1>, label: (n: number) => string): number {
  const taken = new Set(queries.map((query) => query.name));
  let n = 1;
  while (taken.has(label(n))) n += 1;
  return n;
}

/**
 * Opening, closing and saving query tabs. Anything that opens a tab passes
 * the Free tab budget first; `onViewReset` clears the results view.
 */
export function useSqlQueryTabActions(onViewReset: () => void) {
  const { t } = useTranslation();
  const { track } = useTelemetry();
  const admit = useCallback(() => admitSqlQueryTab(track), [track]);
  const [saveDialog, setSaveDialog] = useState<SqlSaveDialogState | null>(null);
  const [closePromptId, setClosePromptId] = useState<string | null>(null);

  const create = useCallback(
    (sql = '', name = '') => {
      if (!admit()) return;
      const store = useWorkspaceSqlStore.getState();
      const label = (n: number) => t('sqlWorkspace.scratch.name', { n });
      const scratchName = name || label(nextScratchNumber(store.queries, label));
      store.createQuery(
        createBlankSqlQuery({ id: crypto.randomUUID(), name: scratchName, query: sql, kind: 'scratch' })
      );
      setSaveDialog(null);
      onViewReset();
    },
    [admit, onViewReset, t]
  );

  const select = useCallback(
    (id: string) => {
      const store = useWorkspaceSqlStore.getState();
      if (!store.openQueryIds.includes(id) && !admit()) return;
      store.openQueryTab(id);
      setSaveDialog((dialog) => (dialog?.queryId === id ? dialog : null));
      onViewReset();
    },
    [admit, onViewReset]
  );

  const close = useCallback((id: string) => {
    const query = useWorkspaceSqlStore.getState().getQuery(id);
    if (query?.kind === 'scratch' && query.query.trim().length > 0) {
      setClosePromptId(id);
      return;
    }
    useWorkspaceSqlStore.getState().closeQueryTab(id);
  }, []);

  const rename = useCallback((id: string, name: string) => {
    useWorkspaceSqlStore.getState().updateQuery(id, { name });
  }, []);

  const duplicate = useCallback(
    (id: string) => {
      if (!admit()) return;
      const source = useWorkspaceSqlStore.getState().getQuery(id);
      const baseName =
        source && source.name.trim().length > 0
          ? source.name.trim()
          : t('sqlWorkspace.queryList.renamePlaceholder');
      useWorkspaceSqlStore.getState().duplicateQuery(id, {
        id: crypto.randomUUID(),
        name: t('sqlWorkspace.queryList.duplicateName', { name: baseName }),
      });
      onViewReset();
    },
    [admit, onViewReset, t]
  );

  const remove = useCallback(
    (id: string) => {
      useWorkspaceSqlStore.getState().deleteQuery(id);
      onViewReset();
    },
    [onViewReset]
  );

  // Saved queries save as you type, so Mod+S on one only confirms it.
  const save = useCallback((as: boolean) => {
    const store = useWorkspaceSqlStore.getState();
    const query = store.activeQueryId === null ? undefined : store.getQuery(store.activeQueryId);
    if (!query) return;
    if (query.kind !== 'scratch' && !as) {
      useUIStore.getState().pushStatusNotice({ tone: 'info', messageKey: 'sqlWorkspace.save.alreadySaved' });
      return;
    }
    setSaveDialog({ queryId: query.id, mode: as && query.kind !== 'scratch' ? 'saveAs' : 'save' });
  }, []);

  const confirmSave = useCallback(
    (options: { name: string; folder?: string }) => {
      const store = useWorkspaceSqlStore.getState();
      if (saveDialog === null) return;
      const id = saveDialog.queryId;
      if (saveDialog.mode === 'saveAs') store.saveQueryAs(id, { id: crypto.randomUUID(), ...options });
      else store.saveQuery(id, options);
      if (saveDialog.closeAfter) store.closeQueryTab(id);
      setSaveDialog(null);
      useUIStore.getState().pushStatusNotice({ tone: 'success', messageKey: 'sqlWorkspace.save.saved' });
    },
    [saveDialog]
  );

  const saveBeforeClose = useCallback((id: string) => {
    setClosePromptId(null);
    useWorkspaceSqlStore.getState().openQueryTab(id);
    setSaveDialog({ queryId: id, mode: 'save', closeAfter: true });
  }, []);

  const discard = useCallback((id: string) => {
    setClosePromptId(null);
    useWorkspaceSqlStore.getState().closeQueryTab(id);
  }, []);

  const openHistoryEntry = useCallback((entry: SqlHistoryEntryV1) => create(entry.sql), [create]);

  return {
    create,
    select,
    close,
    rename,
    duplicate,
    remove,
    save,
    confirmSave,
    saveDialog,
    cancelSave: () => setSaveDialog(null),
    closePromptId,
    cancelClose: () => setClosePromptId(null),
    saveBeforeClose,
    discard,
    openHistoryEntry,
  };
}
