import { Loader2, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keyColumns } from '../../../shared/sqlRowEdits';
import type { SqlRowEdits } from '../../hooks/useSqlRowEdits';
import { cn } from '../../utils/cn';
import { BUTTON, PRIMARY } from './sqlConnectionForm';
import { addRow, stagedCount } from './sqlRowEditModel';
import '../../i18n/sqlConnectionsCatalog';

/** Above the grid of an Explorer table: staged changes, Add row, Discard, Review SQL and Commit, or why the table is read-only. */
export function SqlRowEditBar({ edits }: { edits: SqlRowEdits }) {
  const { t } = useTranslation();
  const [reviewOpen, setReviewOpen] = useState(false);
  const { target, reason, notice, busy } = edits;
  if (reason) {
    return (
      <div data-testid="sql-edit-readonly" className="mx-2.5 mt-2 flex items-center gap-2 text-caption text-fg-muted">
        <Lock size={11} aria-hidden="true" />
        {t(`sqlWorkspace.edits.readOnly.${reason}`)}
      </div>
    );
  }
  if (!target) return null;
  const count = stagedCount(edits.edits);
  const tableLabel = `${target.schema ? `${target.schema}.` : ''}${target.name}`;
  const keyLabel = target.key.kind === 'rowid' ? t('sqlWorkspace.edits.byRowid') : t('sqlWorkspace.edits.byKey', { columns: keyColumns(target).join(', ') });
  return (
    <div data-testid="sql-edit-bar" className="shrink-0">
      <div className="mx-2.5 mt-2 flex h-9 items-center gap-2 border-b border-border-subtle">
        {count > 0 ? (
          <span data-testid="sql-edit-count" className="shrink-0 rounded border border-warning-fg bg-warning-bg px-1.5 font-mono text-micro font-semibold uppercase tracking-[0.06em] text-warning-fg">
            {t('sqlWorkspace.edits.staged', { count })}
          </span>
        ) : (
          <span className="shrink-0 text-caption text-fg-muted">{t('sqlWorkspace.edits.hint')}</span>
        )}
        <span className="min-w-0 truncate font-mono text-caption text-fg-subtle">
          {tableLabel} · {keyLabel}
        </span>
        <span className="flex-1" />
        <button type="button" data-testid="sql-edit-add" disabled={busy} onClick={() => edits.update((current) => addRow(current, target))} className={BUTTON}>
          <Plus size={12} aria-hidden="true" />
          {t('sqlWorkspace.edits.addRow')}
        </button>
        {count > 0 ? (
          <>
            <button type="button" data-testid="sql-edit-discard" disabled={busy} onClick={edits.discard} className={BUTTON}>
              {t('sqlWorkspace.edits.discard')}
            </button>
            <button type="button" data-testid="sql-edit-review" aria-pressed={reviewOpen} onClick={() => setReviewOpen((open) => !open)} className={cn(BUTTON, reviewOpen && 'border-border-strong')}>
              {t('sqlWorkspace.edits.review')}
            </button>
            <button type="button" data-testid="sql-edit-commit" disabled={busy} onClick={edits.commit} className={PRIMARY}>
              {busy ? <Loader2 size={12} aria-hidden="true" className="animate-spin" /> : null}
              {t('sqlWorkspace.edits.commit')}
            </button>
          </>
        ) : null}
      </div>
      {reviewOpen && count > 0 ? (
        <div data-testid="sql-edit-review-panel" className="mx-2.5 mt-2 rounded-lg border border-border-default bg-bg-inset px-3 py-2.5">
          <span className="font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{t('sqlWorkspace.edits.oneTransaction')}</span>
          <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-caption leading-[19px] text-fg-base [font-variant-ligatures:none]">{edits.review}</pre>
        </div>
      ) : null}
      {notice ? (
        <p data-testid="sql-edit-notice" role={notice.tone === 'error' ? 'alert' : 'status'} className={cn('mx-2.5 mt-1.5 text-caption', notice.tone === 'error' ? 'text-error-fg' : 'text-success-fg')}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
