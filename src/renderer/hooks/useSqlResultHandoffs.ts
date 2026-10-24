import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getBundledAppInfo } from '../../shared/appInfo';
import { formatNumber } from '../i18n/formatNumber';
import { dedupeTableName, isValidTableName, type SqlQueryV1, type SqlResponseV1 } from '../../shared/sqlWorkspace';
import { isWriteSqlStatementOn, splitSqlStatements } from '../../shared/sqlStatements';
import type { SqlRemoteEngine } from '../../shared/sqlConnections';
import { executeQuery } from '../runtime/duckdbClient';
import { copyConnectionResultToLocal, CopyToLocalError } from '../runtime/sqlCopyToLocal';
import { sqlDbBridge } from '../runtime/sqlRemote';
import { buildColumnProfileQuery } from '../runtime/sqlColumnProfile';
import { buildSqlResponseCapsule } from '../runtime/sqlResponseCapsule';
import { loadCapsuleExporter } from '../components/Editor/runCapsuleExportLoader';
import { useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { quoteSqlIdentifier } from '../components/SqlWorkspace/sqlResultFormatters';
import { rowsToPythonSource } from '../components/SqlWorkspace/sqlResultExport';
import type { SqlResultHandoffs } from '../components/SqlWorkspace/SqlExportDialog';
import type { SqlResultSource } from '../components/SqlWorkspace/SqlResultPreview';
import { appPlatform } from '../utils/appPlatform';

/** The connection a result came from and the read that gives all of it, for Copy to Local. */
export interface SqlCopySource {
  connectionId: string;
  connectionName: string;
  /** The editor's statement, or the whole table for one opened from the Explorer. */
  sql: string;
  /** A suggested name for the Local table. */
  name: string;
  /** The connection's engine, which decides whether the statement reads. */
  engine: SqlRemoteEngine;
}

interface HandoffInput {
  response: SqlResponseV1 | null;
  /** Set when the result came from a connection. */
  copySource?: SqlCopySource;
  source: SqlResultSource | undefined;
  /** The query whose run is on screen; absent for a table opened from the Explorer. */
  query: SqlQueryV1 | undefined;
  existingTableNames: ReadonlyArray<string>;
  timeoutMs: number;
  onTableCreated: () => void;
}

const notice = (
  tone: 'success' | 'warning' | 'error',
  messageKey: string,
  values?: Record<string, string | number>
) => useUIStore.getState().pushStatusNotice({ tone, messageKey, ...(values ? { values } : {}) });

/** The hand-offs under Export full result…: Save as table (Copy to Local for a connection), Send to Python tab, Save as run capsule. */
export function useSqlResultHandoffs({
  response,
  copySource,
  source,
  query,
  existingTableNames,
  timeoutMs,
  onTableCreated,
}: HandoffInput): SqlResultHandoffs {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    if (response === null || (response.status !== 'success' && response.status !== 'too-large')) {
      return {};
    }
    // CREATE TABLE … AS and the full export re-run the source on Local DuckDB, so it must be one
    // read statement that ran there, not on a saved connection.
    const readSource =
      response.engine === undefined && source !== undefined && buildColumnProfileQuery(source.sql) !== null
        ? source.sql.trim().replace(/;\s*$/, '')
        : null;
    // Quoted identifiers may hold line breaks; one would end the Python comment the label sits in.
    const label = (
      source?.origin === 'table'
        ? source.tableName
        : query?.name.trim() || t('sqlWorkspace.queryList.renamePlaceholder')
    ).replace(/[\r\n\u2028\u2029]+/g, ' ');

    const handoffs: SqlResultHandoffs = {
      ...(response.engine !== undefined ? { remote: true as const } : {}),
      onSendToPython: rows => {
        const { source: code, included } = rowsToPythonSource(
          response.columns,
          rows,
          (shown) =>
            t('sqlWorkspace.handoff.pythonHeader', { name: label, shown, total: response.rowCount })
        );
        const id = crypto.randomUUID();
        useEditorStore
          .getState()
          .addTab({ id, name: 'sql_rows.py', language: 'python', content: code });
        // addTab refuses past the Free tab limit and shows the upsell itself.
        if (useEditorStore.getState().tabs.some(tab => tab.id === id)) {
          notice('success', 'sqlWorkspace.handoff.pythonSent', { count: included });
        }
      },
    };

    if (readSource !== null) {
      handoffs.fullResult = { sql: readSource, timeoutMs };
      handoffs.saveAsTable = {
        suggestedName: dedupeTableName('result', existingTableNames),
        existingNames: existingTableNames,
        onSave: async tableName => {
          const outcome = await executeQuery(
            `CREATE TABLE ${quoteSqlIdentifier(tableName)} AS ${readSource};`,
            { timeoutMs }
          );
          if (outcome.status !== 'success') {
            notice('error', 'sqlWorkspace.handoff.tableFailed', {
              detail: outcome.errorMessage ?? outcome.status,
            });
            return false;
          }
          notice('success', 'sqlWorkspace.handoff.tableCreated', { name: tableName });
          onTableCreated();
          return true;
        },
      };
    }

    // Copy to Local runs the read again on its connection and fills a new Local table.
    const db = sqlDbBridge();
    const copySql = copySource?.sql.trim().replace(/;\s*$/, '');
    if (response.engine !== undefined && copySource && copySql && db && splitSqlStatements(copySql).length === 1 && !isWriteSqlStatementOn(copySource.engine, copySql)) {
      handoffs.saveAsTable = {
        copy: true,
        suggestedName: dedupeTableName(isValidTableName(copySource.name) ? copySource.name : 'result', existingTableNames),
        existingNames: existingTableNames,
        onSave: async (tableName, context) => {
          try {
            const copied = await copyConnectionResultToLocal({
              db,
              connectionId: copySource.connectionId,
              connectionName: copySource.connectionName,
              sql: copySql,
              table: tableName,
              timeoutMs,
              ...(context?.signal ? { signal: context.signal } : {}),
              ...(context?.onProgress ? { onProgress: context.onProgress } : {}),
            });
            notice(copied.truncated ? 'warning' : 'success', copied.truncated ? 'sqlWorkspace.handoff.copiedTruncated' : 'sqlWorkspace.handoff.copied', {
              name: tableName,
              count: copied.rowCount,
              formatted: formatNumber(copied.rowCount, i18n.language),
            });
            onTableCreated();
            return true;
          } catch (err) {
            const cancelled = err instanceof CopyToLocalError && err.cancelled;
            if (cancelled) useUIStore.getState().pushStatusNotice({ tone: 'info', messageKey: 'sqlWorkspace.handoff.copyCancelled' });
            else if (err instanceof CopyToLocalError && err.value) notice('error', 'sqlWorkspace.handoff.copyBadValue', err.value);
            else if (err instanceof CopyToLocalError && err.repeated !== undefined) notice('error', 'sqlWorkspace.handoff.copyRepeatedName', { name: err.repeated });
            else useUIStore.getState().pushStatusNotice({ tone: 'error', messageKey: 'sqlWorkspace.handoff.copyFailed', detail: err instanceof Error ? err.message : String(err) });
            return false;
          }
        },
      };
    }

    if (source !== undefined) {
      handoffs.onSaveCapsule = () => {
        const now = new Date().toISOString();
        const capsuleQuery: SqlQueryV1 = query
          ? { ...query, query: source.sql }
          : {
              version: 1,
              id: crypto.randomUUID(),
              name: label,
              query: source.sql,
              createdAt: now,
              updatedAt: now,
            };
        void (async () => {
          try {
            const capsule = await buildSqlResponseCapsule({
              appVersion: getBundledAppInfo().version,
              query: capsuleQuery,
              response,
              platform: appPlatform(),
            });
            const { exportCapsuleToClipboard } = await loadCapsuleExporter();
            const result = await exportCapsuleToClipboard(capsule, 'result-panel-export');
            notice(
              result.ok ? 'success' : 'warning',
              result.ok
                ? 'settings.account.runCapsules.copiedNotice'
                : 'results.actions.exportCapsule.clipboardUnavailable'
            );
          } catch {
            notice('warning', 'results.actions.exportCapsule.loadFailed');
          }
        })();
      };
    }
    return handoffs;
  }, [response, copySource, source, query, existingTableNames, timeoutMs, onTableCreated, t, i18n.language]);
}
