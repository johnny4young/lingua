import { useTranslation } from 'react-i18next';

interface NotebookStaleNoticeProps {
  readonly staleCount: number;
  readonly disabled: boolean;
  readonly onRefresh: () => void;
}

/** The notebook's one stale notice, at the end of the toolbar, with the replay that clears it. */
export function NotebookStaleNotice({ staleCount, disabled, onRefresh }: NotebookStaleNoticeProps) {
  const { t } = useTranslation();
  if (staleCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="notebook-reactivity-banner"
      title={t('notebook.reactivity.lazyHint')}
      className="ml-auto flex min-w-0 items-center gap-3 rounded-md border border-warning-border bg-warning-bg py-0.5 pl-3 pr-0.5 text-caption"
    >
      <span className="shrink-0 font-semibold text-warning-fg">
        {t('notebook.reactivity.summary', { count: staleCount })}
      </span>
      <span className="hidden min-w-0 truncate text-fg-muted min-[1800px]:inline">
        {t('notebook.reactivity.lazyHint')}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled}
        title={t('notebook.reactivity.refreshHint')}
        data-testid="notebook-toolbar-refresh-stale"
        className="focus-ring inline-flex h-6 shrink-0 items-center rounded border border-border-default bg-bg-base px-2.5 font-medium text-fg-base transition-colors duration-150 hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t('notebook.reactivity.refreshButton', { count: staleCount })}
      </button>
    </div>
  );
}
