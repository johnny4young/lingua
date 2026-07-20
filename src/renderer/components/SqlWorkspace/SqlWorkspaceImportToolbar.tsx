import { FilePlus2, Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SQL_IMPORT_FILE_ACCEPT } from '../../../shared/sqlWorkspace';

interface SqlWorkspaceImportToolbarProps {
  isBusy: boolean;
  isPreviewing: boolean;
  onImportFile: (file: File) => void;
}

/** Keyboard-operable entry point for the SQL workspace import flow. */
export function SqlWorkspaceImportToolbar({
  isBusy,
  isPreviewing,
  onImportFile,
}: SqlWorkspaceImportToolbarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isBusy}
        aria-label={t('sqlWorkspace.import.buttonAria')}
        data-testid="sql-workspace-import"
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-panel-alt px-2.5 py-1 text-body-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPreviewing ? (
          <Loader2 size={13} aria-hidden="true" className="animate-spin" />
        ) : (
          <FilePlus2 size={13} aria-hidden="true" />
        )}
        {isPreviewing
          ? t('sqlWorkspace.import.loadingPreview')
          : t('sqlWorkspace.import.button')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={SQL_IMPORT_FILE_ACCEPT}
        disabled={isBusy}
        aria-label={t('sqlWorkspace.import.buttonAria')}
        data-testid="sql-workspace-import-input"
        className="internal"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportFile(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
