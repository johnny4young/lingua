import { NOTEBOOK_CELL_LANGUAGES, type NotebookCellLanguage } from '../../../shared/notebook';

export function notebookTitleFromTabName(name: string): string {
  const withoutExtension = name.endsWith('.linguanb')
    ? name.slice(0, -'.linguanb'.length)
    : name;
  return withoutExtension.trim() || 'Untitled notebook';
}

export function coerceNotebookCellLanguage(
  language: string | null | undefined
): NotebookCellLanguage | null {
  if (
    typeof language === 'string' &&
    (NOTEBOOK_CELL_LANGUAGES as readonly string[]).includes(language)
  ) {
    return language as NotebookCellLanguage;
  }
  return null;
}
