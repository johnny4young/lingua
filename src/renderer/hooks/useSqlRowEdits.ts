/**
 * Staged edits on the table opened from the Explorer: the change set, the
 * review, and Commit in one transaction, on Local or through main for a
 * connection. A new read of the table starts a new change set.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlDbApplyResult } from '../../shared/sqlDb';
import { rowEditReview, rowEditStatements, type RowEditFailure } from '../../shared/sqlRowEdits';
import { changeSet, NO_EDITS, stagedCount, type StagedEdits } from '../components/SqlWorkspace/sqlRowEditModel';
import { applyLocalEdits } from '../runtime/sqlLocalEdits';
import { sqlDbBridge } from '../runtime/sqlRemote';
import { findConnection } from '../stores/sqlConnectionsStore';
import type { SqlTablePreview } from './useSqlTablePreview';
import type { SqlWriteConfirm } from './useSqlRunner';
import '../i18n/sqlConnectionsCatalog';

export interface SqlRowEditNotice {
  tone: 'ok' | 'error';
  text: string;
}

export function useSqlRowEdits(preview: SqlTablePreview | null, reload: (preview: SqlTablePreview) => void) {
  const { t } = useTranslation();
  const target = preview?.edit && 'table' in preview.edit ? preview.edit.table : null;
  // Staged edits belong to one read of one table.
  const readKey = preview ? `${preview.connectionId ?? 'local'}|${preview.sql}|${preview.response.recordedAt}` : '';
  const [state, setState] = useState<{ key: string; edits: StagedEdits }>({ key: '', edits: NO_EDITS });
  const edits = state.key === readKey ? state.edits : NO_EDITS;
  // A notice outlives the read a commit replaces, but not the table.
  const tableKey = preview ? `${preview.connectionId ?? 'local'}|${preview.table.name}` : '';
  const [shownNotice, setShownNotice] = useState<{ key: string; notice: SqlRowEditNotice | null }>({ key: '', notice: null });
  const notice = shownNotice.key === tableKey ? shownNotice.notice : null;
  const setNotice = (next: SqlRowEditNotice | null) => setShownNotice({ key: tableKey, notice: next });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<SqlWriteConfirm | null>(null);

  const update = useCallback(
    (next: (current: StagedEdits) => StagedEdits) => {
      setShownNotice({ key: tableKey, notice: null });
      setState((current) => ({ key: readKey, edits: next(current.key === readKey ? current.edits : NO_EDITS) }));
    },
    [readKey, tableKey]
  );

  const editFailure = (edit: RowEditFailure) =>
    edit.kind === 'conflict' ? t('sqlWorkspace.edits.conflict', { change: edit.change, count: edit.touched }) : t('sqlWorkspace.edits.tooSlow');

  const failure = (result: Extract<SqlDbApplyResult, { ok: false }>) =>
    result.edit
      ? editFailure(result.edit)
      : result.reason === 'failed'
      ? result.fix === 'password-needed' || result.fix === 'ssh-password-needed'
        ? t('sqlWorkspace.edits.needsPassword')
        : (result.message ?? t('sqlWorkspace.edits.failed'))
      : t(`sqlWorkspace.edits.refused.${result.reason}`);

  const commit = async (confirmName?: string) => {
    if (!preview || !target || stagedCount(edits) === 0) return;
    const changes = changeSet(edits);
    const connection = preview.connectionId ? findConnection(preview.connectionId) : undefined;
    const askName = () =>
      setConfirm({
        connectionName: connection?.name ?? '',
        statements: rowEditStatements(target, changes, true).map(({ sql }) => sql),
        estimate: null,
        readOnly: false,
        production: false,
      });
    if (connection?.confirmWrites && confirmName === undefined) {
      askName();
      return;
    }
    const db = preview.connectionId ? sqlDbBridge() : null;
    if (preview.connectionId && !db) {
      setNotice({ tone: 'error', text: t('sqlWorkspace.edits.failed') });
      return;
    }
    setBusy(true);
    let result: SqlDbApplyResult | { applied: number } | { errorMessage: string } | { edit: RowEditFailure };
    try {
      result =
        db && preview.connectionId
          ? await db.applyEdits(preview.connectionId, { schema: target.schema ?? '', name: target.name }, changes, confirmName)
          : await applyLocalEdits(target, changes);
    } catch {
      result = { errorMessage: t('sqlWorkspace.edits.failed') };
    } finally {
      setBusy(false);
    }
    if ('applied' in result) {
      setNotice({ tone: 'ok', text: t('sqlWorkspace.edits.committed', { count: result.applied }) });
      reload(preview);
    } else if ('errorMessage' in result) {
      setNotice({ tone: 'error', text: result.errorMessage });
    } else if (!('ok' in result)) {
      setNotice({ tone: 'error', text: editFailure(result.edit) });
    } else if (!result.ok && result.reason === 'confirm-needed' && confirmName === undefined && connection) {
      // Main knows the switch is on even when this copy of the catalog does not yet.
      askName();
    } else if (!result.ok) {
      setNotice({ tone: 'error', text: failure(result) });
    }
  };

  return {
    target,
    /** Why this table is read-only, when Edit table rows is on. */
    reason: preview?.edit && 'reason' in preview.edit ? preview.edit.reason : null,
    edits,
    update,
    discard: () => update(() => NO_EDITS),
    review: target ? rowEditReview(target, changeSet(edits)) : '',
    commit: () => void commit(),
    busy,
    notice,
    confirm,
    resolveConfirm: (name: string | null) => {
      setConfirm(null);
      if (name !== null) void commit(name);
    },
  };
}

export type SqlRowEdits = ReturnType<typeof useSqlRowEdits>;
