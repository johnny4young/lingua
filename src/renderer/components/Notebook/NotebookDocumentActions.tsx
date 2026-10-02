import { FolderOpen, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { notebookDocumentNotice } from '../../stores/notebookDocumentPersistence';

/** Manual document actions; exporting remains a separate, unbound operation. */
export function NotebookDocumentActions({ tabId }: { tabId: string }) {
  const { t } = useTranslation();
  const isDirty = useEditorStore(
    state => state.tabs.find(tab => tab.id === tabId)?.isDirty ?? false
  );
  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="notebook-document-actions">
      <button
        type="button"
        className="button-ghost h-7 w-7 p-1"
        aria-label={t('commandPalette.action.openFile.label')}
        title={t('commandPalette.action.openFile.label')}
        data-testid="notebook-document-open"
        onClick={() => {
          void useEditorStore
            .getState()
            .openFileFromDisk()
            .catch(() => notebookDocumentNotice('openFailed'));
        }}
      >
        <FolderOpen size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="button-ghost h-7 w-7 p-1"
        aria-label={t('shortcuts.item.save.label')}
        title={t('shortcuts.item.save.label')}
        data-testid="notebook-document-save"
        onClick={() => {
          void useEditorStore
            .getState()
            .saveTabById(tabId)
            .catch(() => notebookDocumentNotice('writeFailed'));
        }}
      >
        <Save size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="button-ghost h-7 w-7 p-1"
        aria-label={t('commandPalette.action.saveAs.label')}
        title={t('commandPalette.action.saveAs.label')}
        data-testid="notebook-document-save-as"
        onClick={() => {
          void useEditorStore
            .getState()
            .saveTabById(tabId, true)
            .catch(() => notebookDocumentNotice('writeFailed'));
        }}
      >
        <Save size={14} aria-hidden="true" />
      </button>
      {isDirty && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-warning"
          role="img"
          aria-label={t('editorTabs.unsavedTitle')}
          data-testid="notebook-document-dirty"
        />
      )}
    </div>
  );
}
