import i18next from 'i18next';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';

/** Saves SQL to Snippets under `label`, and says so; the store explains a refusal. */
export function saveSqlSnippet(code: string, label?: string): void {
  const id = useSnippetsStore.getState().addSnippet({
    language: 'sql',
    label: label?.trim() || i18next.t('sqlWorkspace.snippet.defaultLabel'),
    description: i18next.t('sqlWorkspace.snippet.description'),
    code,
  });
  if (id !== null) useUIStore.getState().pushStatusNotice({ tone: 'success', messageKey: 'sqlWorkspace.snippet.saved' });
}
