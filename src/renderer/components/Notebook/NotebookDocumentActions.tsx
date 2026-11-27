import { FilePlus2, FolderOpen, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../ui/chrome';
import { ICON_GLYPH } from '../ui/iconScale';
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
      <IconButton
        tooltipSide="bottom"
        tooltip={t('commandPalette.action.openFile.label')}
        data-testid="notebook-document-open"
        onClick={() => {
          void useEditorStore
            .getState()
            .openFileFromDisk()
            .catch(() => notebookDocumentNotice('openFailed'));
        }}
      >
        <FolderOpen size={ICON_GLYPH.md} aria-hidden="true" />
      </IconButton>
      <IconButton
        tooltipSide="bottom"
        tooltip={t('shortcuts.item.save.label')}
        data-testid="notebook-document-save"
        onClick={() => {
          void useEditorStore
            .getState()
            .saveTabById(tabId)
            .catch(() => notebookDocumentNotice('writeFailed'));
        }}
      >
        <Save size={ICON_GLYPH.md} aria-hidden="true" />
      </IconButton>
      <IconButton
        tooltipSide="bottom"
        tooltip={t('commandPalette.action.saveAs.label')}
        data-testid="notebook-document-save-as"
        onClick={() => {
          void useEditorStore
            .getState()
            .saveTabById(tabId, true)
            .catch(() => notebookDocumentNotice('writeFailed'));
        }}
      >
        <FilePlus2 size={ICON_GLYPH.md} aria-hidden="true" />
      </IconButton>
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
