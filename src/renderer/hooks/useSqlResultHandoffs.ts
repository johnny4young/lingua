import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getBundledAppInfo } from '../../shared/appInfo';
import { dedupeTableName, type SqlQueryV1, type SqlResponseV1 } from '../../shared/sqlWorkspace';
import { executeQuery } from '../runtime/duckdbClient';
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

interface HandoffInput {
  response: SqlResponseV1 | null;
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

/** The Local hand-offs under Export full result…: Save as table, Send to Python tab, Save as run capsule. */
export function useSqlResultHandoffs({
  response,
  source,
  query,
  existingTableNames,
  timeoutMs,
  onTableCreated,
}: HandoffInput): SqlResultHandoffs {
  const { t } = useTranslation();
  return useMemo(() => {
    if (response === null || (response.status !== 'success' && response.status !== 'too-large')) {
      return {};
    }
    // CREATE TABLE … AS re-runs the source, so it must be one read statement.
    const readSource =
      source !== undefined && buildColumnProfileQuery(source.sql) !== null
        ? source.sql.trim().replace(/;\s*$/, '')
        : null;
    // Quoted identifiers may hold line breaks; one would end the Python comment the label sits in.
    const label = (
      source?.origin === 'table'
        ? source.tableName
        : query?.name.trim() || t('sqlWorkspace.queryList.renamePlaceholder')
    ).replace(/[\r\n\u2028\u2029]+/g, ' ');

    const handoffs: SqlResultHandoffs = {
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
  }, [response, source, query, existingTableNames, timeoutMs, onTableCreated, t]);
}
