import { Database, FilePlus2, Plus } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SQL_IMPORT_FILE_ACCEPT } from '../../../shared/sqlWorkspace';
import { EmptyState } from '../ui/EmptyState';

/**
 * internal — actionable empty state for the SQL workspace.
 *
 * A brand-new SQL workspace has no queries AND no tables, so the old
 * "New query" CTA alone dropped the user onto a query with nothing to
 * SELECT from. The real first move for most people is loading data, so
 * this surfaces a secondary "Import data" affordance (CSV / JSON /
 * Parquet) next to "New query" — the same import flow the toolbar
 * drives, reachable without hunting for it.
 */
export function SqlEmptyState({
  onCreate,
  onImportFile,
}: {
  onCreate: () => void;
  onImportFile: (file: File) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      data-testid="sql-workspace-empty"
      className="grid h-full place-items-center px-6 py-10"
    >
      <EmptyState
        icon={<Database size={19} aria-hidden="true" />}
        title={t('sqlWorkspace.empty.title')}
        description={t('sqlWorkspace.empty.body')}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onCreate}
              data-testid="sql-workspace-empty-create"
              className="focus-ring inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-body-sm font-semibold text-fg-on-accent transition-colors hover:bg-accent-hover"
            >
              <Plus size={13} aria-hidden="true" />
              {t('sqlWorkspace.empty.cta')}
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              data-testid="sql-workspace-empty-import"
              className="focus-ring inline-flex items-center gap-2 rounded-md border border-border-subtle bg-bg-panel-alt px-3.5 py-2 text-body-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base"
            >
              <FilePlus2 size={13} aria-hidden="true" />
              {t('sqlWorkspace.import.button')}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={SQL_IMPORT_FILE_ACCEPT}
              aria-label={t('sqlWorkspace.import.buttonAria')}
              data-testid="sql-workspace-empty-import-input"
              className="internal"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportFile(file);
                event.target.value = '';
              }}
            />
          </div>
        }
      />
    </div>
  );
}
