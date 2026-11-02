import i18next from 'i18next';
import type { SqlEngineKind } from '../../../shared/sqlConnections';
import { redactSqlSecrets } from '../../../shared/sqlStatements';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';

/** Saves the SQL a grid's filters and sort generate; a snippet outlives the session, so literal secrets are masked first. */
export function saveGridSqlAsSnippet(sql: string, engine: SqlEngineKind | undefined): void {
  const id = useSnippetsStore.getState().addSnippet({
    language: 'sql',
    label: i18next.t('sqlWorkspace.snippet.defaultLabel'),
    description: i18next.t('sqlWorkspace.snippet.description'),
    code: redactSqlSecrets(sql, engine),
  });
  if (id !== null) useUIStore.getState().pushStatusNotice({ tone: 'success', messageKey: 'sqlWorkspace.snippet.saved' });
}
