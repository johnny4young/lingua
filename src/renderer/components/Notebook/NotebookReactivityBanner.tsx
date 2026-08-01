import { useTranslation } from 'react-i18next';

interface NotebookReactivityBannerProps {
  readonly staleCount: number;
}

export function NotebookReactivityBanner({
  staleCount,
}: NotebookReactivityBannerProps) {
  const { t } = useTranslation();
  if (staleCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="notebook-reactivity-banner"
      className="flex items-center justify-between gap-3 border-b border-warning-border/60 bg-warning-bg px-4 py-2 text-caption text-warning-fg"
    >
      <span className="font-medium">
        {t('notebook.reactivity.summary', { count: staleCount })}
      </span>
      <span className="hidden text-right text-fg-subtle md:inline">
        {t('notebook.reactivity.lazyHint')}
      </span>
    </div>
  );
}
