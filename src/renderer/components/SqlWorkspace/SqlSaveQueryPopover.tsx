import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MAX_SQL_FOLDER_LENGTH } from '../../../shared/sqlWorkspace';
import { useFloatingPosition } from './useFloatingPosition';

const NEW_FOLDER = '\u0000new';
const FIELD =
  'h-7 w-full rounded-md border border-border-default bg-bg-inset px-2 text-body-sm text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none';
const LABEL = 'mb-1 block font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle';

/** Mod+S names and files a query; Mod+Shift+S saves a copy. Connection is always Local for now. */
export function SqlSaveQueryPopover({
  anchor,
  mode,
  initialName,
  initialFolder,
  folders,
  onSave,
  onCancel,
  connectionLabel,
}: {
  /** The editor pane; the popover pins to its top-right corner. */
  anchor: RefObject<HTMLElement | null>;
  mode: 'save' | 'saveAs';
  initialName: string;
  initialFolder?: string;
  folders: ReadonlyArray<string>;
  onSave: (options: { name: string; folder?: string }) => void;
  onCancel: () => void;
  /** The saved connection the query runs on; Local when absent. */
  connectionLabel?: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [folderChoice, setFolderChoice] = useState(initialFolder ?? '');
  const [newFolder, setNewFolder] = useState('');
  const nameRef = useRef<HTMLInputElement | null>(null);
  const position = useFloatingPosition(anchor, true, 'inside');

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
    nameRef.current?.select();
  }, []);

  const folder = folderChoice === NEW_FOLDER ? newFolder.trim() : folderChoice;
  const canSave = name.trim().length > 0 && (folderChoice !== NEW_FOLDER || folder.length > 0);
  const submit = () => {
    if (canSave) onSave({ name: name.trim(), ...(folder.length > 0 ? { folder } : {}) });
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t(mode === 'save' ? 'sqlWorkspace.save.title' : 'sqlWorkspace.save.titleAs')}
      data-testid="sql-save-popover"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
      style={position}
      className="z-50 w-[280px] max-w-[calc(100vw-24px)] rounded-lg border border-border-default bg-bg-panel p-3 shadow-e3"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2.5"
      >
        <p className="text-body-sm font-semibold text-fg-base">
          {t(mode === 'save' ? 'sqlWorkspace.save.title' : 'sqlWorkspace.save.titleAs')}
        </p>
        <label>
          <span className={LABEL}>{t('sqlWorkspace.save.name')}</span>
          <input
            ref={nameRef}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            data-testid="sql-save-name"
            className={FIELD}
          />
        </label>
        <label>
          <span className={LABEL}>{t('sqlWorkspace.save.folder')}</span>
          <select
            value={folderChoice}
            onChange={(event) => setFolderChoice(event.target.value)}
            data-testid="sql-save-folder"
            className={FIELD}
          >
            <option value="">{t('sqlWorkspace.save.noFolder')}</option>
            {folders.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={NEW_FOLDER}>{t('sqlWorkspace.save.newFolder')}</option>
          </select>
        </label>
        {folderChoice === NEW_FOLDER ? (
          <input
            value={newFolder}
            maxLength={MAX_SQL_FOLDER_LENGTH}
            onChange={(event) => setNewFolder(event.target.value)}
            placeholder={t('sqlWorkspace.save.newFolderPlaceholder')}
            aria-label={t('sqlWorkspace.save.newFolderPlaceholder')}
            data-testid="sql-save-new-folder"
            className={FIELD}
          />
        ) : null}
        <div>
          <span className={LABEL}>{t('sqlWorkspace.save.connection')}</span>
          <p data-testid="sql-save-connection" className="text-body-sm text-fg-muted">
            {connectionLabel ?? t('sqlWorkspace.save.connectionLocal')}
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="button-secondary" data-testid="sql-save-cancel">
            {t('sqlWorkspace.save.cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="button-primary disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="sql-save-confirm"
          >
            {t('sqlWorkspace.save.confirm')}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
