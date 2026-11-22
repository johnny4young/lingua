import { Loader2, Plus } from 'lucide-react';
import { useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { SQL_IMPORT_FILE_ACCEPT } from '../../../shared/sqlWorkspace';

interface SqlImportButtonProps {
  isBusy: boolean;
  isPreviewing: boolean;
  onImportFile: (file: File) => void;
  /** Lets another control (the folded rail) open the same picker. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Only the file input, for when the button itself is not on screen. */
  inputOnly?: boolean;
}

/** Import data at the foot of the explorer: the keyboard path into the import flow. */
export function SqlImportButton({
  isBusy,
  isPreviewing,
  onImportFile,
  inputRef: externalRef,
  inputOnly = false,
}: SqlImportButtonProps) {
  const { t } = useTranslation();
  const ownRef = useRef<HTMLInputElement | null>(null);
  const inputRef = externalRef ?? ownRef;

  return (
    <>
      {inputOnly ? null : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isBusy}
          aria-label={t('sqlWorkspace.import.buttonAria')}
          data-testid="sql-workspace-import"
          className="focus-ring flex h-9 w-full items-center gap-2 px-2.5 text-body-sm text-fg-muted transition-colors hover:bg-bg-panel-alt hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPreviewing ? (
            <Loader2 size={12} aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus size={12} aria-hidden="true" />
          )}
          {isPreviewing
            ? t('sqlWorkspace.import.loadingPreview')
            : t('sqlWorkspace.import.button')}
        </button>
      )}
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
