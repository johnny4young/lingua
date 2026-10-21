import { Download, Loader2 } from 'lucide-react';
import { useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { SQL_IMPORT_FILE_ACCEPT } from '../../../shared/sqlWorkspace';

interface SqlImportButtonProps {
  isBusy: boolean;
  isPreviewing: boolean;
  onImportFile: (file: File) => void;
  /** Lets another control (the folded rail) open the same picker. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/** Import data in the connection bar: the keyboard path into the import flow. */
export function SqlImportButton({
  isBusy,
  isPreviewing,
  onImportFile,
  inputRef: externalRef,
}: SqlImportButtonProps) {
  const { t } = useTranslation();
  const ownRef = useRef<HTMLInputElement | null>(null);
  const inputRef = externalRef ?? ownRef;

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isBusy}
        aria-label={t('sqlWorkspace.import.buttonAria')}
        data-testid="sql-workspace-import"
        className="focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-base transition-colors hover:border-border-strong hover:bg-bg-panel-alt disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPreviewing ? (
          <Loader2 size={12} aria-hidden="true" className="animate-spin" />
        ) : (
          <Download size={12} aria-hidden="true" />
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
        data-testid="sql-workspace-import-input"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportFile(file);
          event.target.value = '';
        }}
      />
    </>
  );
}
