import { NOTEBOOK_CELL_LANGUAGES, type NotebookCellLanguage } from '../../../shared/notebook';

/** A cell editor never grows past this; it scrolls internally beyond it. */
export const NOTEBOOK_CELL_EDITOR_MAX_HEIGHT = 600;

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
