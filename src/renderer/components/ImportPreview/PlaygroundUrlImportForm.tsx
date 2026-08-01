import { Eye, Link2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface PlaygroundUrlImportFormProps {
  readonly value: string;
  readonly isLoading: boolean;
  readonly onChange: (value: string) => void;
  readonly onPreview: () => void;
  readonly onCancel: () => void;
}

/** Explicit opt-in network entry point for supported playground share URLs. */
export function PlaygroundUrlImportForm({
  value,
  isLoading,
  onChange,
  onPreview,
  onCancel,
}: PlaygroundUrlImportFormProps) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="import-preview-playground-url-section"
      className="grid gap-2 rounded-md border border-border-subtle bg-bg-inset p-3 md:col-span-2"
    >
      <div className="flex items-start gap-2">
        <Link2 size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <label
            htmlFor="import-preview-playground-url"
            className="block text-body-sm font-medium text-fg-base"
          >
            {t('importPreview.playground.label')}
          </label>
          <p id="import-preview-playground-hint" className="text-caption text-fg-subtle">
            {t('importPreview.playground.hint')}
          </p>
        </div>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={event => {
          event.preventDefault();
          if (!isLoading && value.trim()) onPreview();
        }}
      >
        <input
          id="import-preview-playground-url"
          data-testid="import-preview-playground-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="import-preview-playground-hint import-preview-playground-network"
          value={value}
          disabled={isLoading}
          onChange={event => onChange(event.target.value)}
          placeholder={t('importPreview.playground.placeholder')}
          className="min-h-10 min-w-0 flex-1 rounded-md border border-border-default bg-bg-panel px-3 font-mono text-body-sm text-fg-base outline-none focus:border-border-strong disabled:cursor-wait disabled:opacity-70"
        />
        {isLoading ? (
          <button
            type="button"
            onClick={onCancel}
            data-testid="import-preview-playground-cancel"
            className="button-ghost min-h-10 shrink-0"
          >
            <X size={13} aria-hidden="true" />
            {t('importPreview.playground.cancel')}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            data-testid="import-preview-playground-preview"
            className="button-secondary min-h-10 shrink-0"
          >
            <Eye size={13} aria-hidden="true" />
            {t('importPreview.playground.preview')}
          </button>
        )}
      </form>
      <p id="import-preview-playground-network" className="text-micro text-fg-subtle">
        {t('importPreview.playground.networkNotice')}
      </p>
    </section>
  );
}
