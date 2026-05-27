/**
 * RL-100 Slice 1 — read-only preview band for the Import overlay.
 *
 * Pure presentation. Renders the parsed cURL shape with sensitive
 * headers visibly redacted (the actual originals stay in the
 * preview's `original` slot and round-trip on confirm). Method
 * surfaces as a color-coded pill (reuses the same palette as the
 * HTTP workspace's `<HttpStatusPill>` so the visual language stays
 * uniform). Body content is shown verbatim with kind labelling.
 */

import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import type { CurlImporterPreview } from '../../../shared/importers/curlImporter';
import { cn } from '../../utils/cn';

export interface ImportPreviewBodyProps {
  preview: CurlImporterPreview;
}

const METHOD_TONE: Record<string, string> = {
  GET: 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300',
  POST: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
  PUT: 'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300',
  PATCH: 'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300',
  DELETE: 'bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300',
  HEAD: 'bg-slate-500/15 text-muted ring-slate-500/30',
  OPTIONS: 'bg-slate-500/15 text-muted ring-slate-500/30',
};

const REDACTED_PLACEHOLDER = '<redacted>';

export function ImportPreviewBody({ preview }: ImportPreviewBodyProps) {
  const { t } = useTranslation();
  const { redacted } = preview;
  const methodTone =
    METHOD_TONE[redacted.method] ??
    'bg-slate-500/15 text-muted ring-slate-500/30';
  const hasRedactedHeader = redacted.headers.some(
    (h) => h.value === REDACTED_PLACEHOLDER
  );

  return (
    <div
      data-testid="import-preview-body"
      className="grid gap-3 rounded-md border border-border/60 bg-surface/30 p-3"
    >
      <header className="flex items-center gap-2">
        <span
          data-testid="import-preview-method"
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1',
            methodTone
          )}
        >
          {redacted.method}
        </span>
        <span
          data-testid="import-preview-url"
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
          title={redacted.url}
        >
          {redacted.url}
        </span>
      </header>

      {redacted.headers.length > 0 ? (
        <section className="grid gap-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
            {t('importPreview.preview.headersLabel')}
            <span className="ml-2 text-muted/70">({redacted.headers.length})</span>
          </div>
          <ul
            role="list"
            data-testid="import-preview-headers"
            className="grid gap-0.5 rounded border border-border/40 bg-background-elevated/50 p-2"
          >
            {redacted.headers.map((header, idx) => {
              const isRedacted = header.value === REDACTED_PLACEHOLDER;
              return (
                <li
                  key={`${header.name}-${idx}`}
                  data-redacted={isRedacted}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <span className="min-w-[120px] shrink-0 truncate text-muted">
                    {header.name}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      isRedacted
                        ? 'inline-flex items-center gap-1 text-amber-700 dark:text-amber-300'
                        : 'text-foreground'
                    )}
                  >
                    {isRedacted ? (
                      <>
                        <Lock size={9} aria-hidden="true" />
                        {REDACTED_PLACEHOLDER}
                      </>
                    ) : (
                      header.value
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {hasRedactedHeader ? (
            <p
              data-testid="import-preview-redacted-hint"
              className="text-[10px] text-muted"
            >
              {t('importPreview.preview.redactedHeaderHint')}
            </p>
          ) : null}
        </section>
      ) : null}

      {redacted.body ? (
        <section className="grid gap-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
            {t('importPreview.preview.bodyLabel')}
            <span className="ml-2 text-muted/70">({redacted.body.kind})</span>
          </div>
          <pre
            data-testid="import-preview-body-content"
            className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded bg-background-elevated/60 p-2 font-mono text-[10px] text-foreground"
          >
            {!redacted.body.content || redacted.body.content.length === 0
              ? '(empty)'
              : redacted.body.content}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
