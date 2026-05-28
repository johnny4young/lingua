/**
 * RL-100 Slice 1 + Slice 2 — read-only preview band for the Import
 * overlay.
 *
 * Pure presentation. Branches on the preview's `kind` discriminator:
 *
 *   - `'curl-http'` (Slice 1) — method pill, URL, headers table with
 *     redaction badges, body kind preview. Sensitive headers visibly
 *     redacted (the actual originals stay in the preview's `original`
 *     slot and round-trip on confirm).
 *   - `'ipynb-notebook'` (Slice 2) — notebook title, fold D summary
 *     chip (cell count + dominant language), first-cells preview band.
 *
 * Fold D — the summary chip shows `{total} cells · {code} code ·
 * {markdown} markdown` plus a dominant-language hint when one stands
 * out.
 */

import { useTranslation } from 'react-i18next';
import { BookOpenText, Lock } from 'lucide-react';
import type { CurlImporterPreview } from '../../../shared/importers/curlImporter';
import type {
  IpynbCellSnippet,
  IpynbImporterPreview,
} from '../../../shared/importers/ipynbImporter';
import { cn } from '../../utils/cn';

export type ImportPreviewBodyShape =
  | (CurlImporterPreview & { readonly kind: 'curl-http' })
  | IpynbImporterPreview;

export interface ImportPreviewBodyProps {
  preview: ImportPreviewBodyShape;
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

const LANGUAGE_TONE: Record<string, string> = {
  javascript: 'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300',
  typescript: 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300',
  python: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
};

const LANGUAGE_LABEL: Record<string, string> = {
  javascript: 'JS',
  typescript: 'TS',
  python: 'PY',
};

export function ImportPreviewBody({ preview }: ImportPreviewBodyProps) {
  if (preview.kind === 'ipynb-notebook') {
    return <NotebookPreviewBand preview={preview} />;
  }
  return <CurlPreviewBand preview={preview} />;
}

// ---------------------------------------------------------------------------
// Slice 1 — cURL preview
// ---------------------------------------------------------------------------

function CurlPreviewBand({ preview }: { preview: CurlImporterPreview }) {
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
      data-preview-kind="curl-http"
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

// ---------------------------------------------------------------------------
// Slice 2 — `.ipynb` preview
// ---------------------------------------------------------------------------

function NotebookPreviewBand({ preview }: { preview: IpynbImporterPreview }) {
  const { t } = useTranslation();
  const { cellCounts, dominantLanguage, title, cellSnippets } = preview;

  return (
    <div
      data-testid="import-preview-body"
      data-preview-kind="ipynb-notebook"
      className="grid gap-3 rounded-md border border-border/60 bg-surface/30 p-3"
    >
      <header className="flex items-center gap-2">
        <span
          className="inline-flex h-5 items-center gap-1 rounded bg-violet-500/15 px-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-violet-500/30 dark:text-violet-300"
          data-testid="import-preview-ipynb-badge"
        >
          <BookOpenText size={11} aria-hidden="true" />
          {t('importPreview.notebook.badge')}
        </span>
        <span
          data-testid="import-preview-notebook-title"
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
          title={title}
        >
          {title}
        </span>
      </header>

      <section className="flex flex-wrap items-center gap-2">
        <span
          data-testid="import-preview-notebook-summary"
          className="inline-flex h-5 items-center rounded-full border border-border/60 bg-surface/50 px-2 text-[10px] text-foreground"
        >
          {t('importPreview.notebook.summary', {
            cells: cellCounts.total,
            code: cellCounts.code,
            markdown: cellCounts.markdown,
          })}
        </span>
        <span
          data-testid="import-preview-notebook-language"
          className={cn(
            'inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium ring-1',
            dominantLanguage
              ? LANGUAGE_TONE[dominantLanguage] ??
                  'bg-slate-500/15 text-muted ring-slate-500/30'
              : 'bg-slate-500/15 text-muted ring-slate-500/30'
          )}
        >
          {dominantLanguage
            ? t('importPreview.notebook.dominantLanguage', {
                language: LANGUAGE_LABEL[dominantLanguage] ?? dominantLanguage,
              })
            : t('importPreview.notebook.dominantLanguageMixed')}
        </span>
        {cellCounts.droppedRaw > 0 ? (
          <span
            data-testid="import-preview-notebook-dropped"
            className="inline-flex h-5 items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 text-[10px] text-amber-700 dark:text-amber-300"
          >
            {t('importPreview.notebook.droppedRawCells', {
              count: cellCounts.droppedRaw,
            })}
          </span>
        ) : null}
      </section>

      {cellSnippets.length > 0 ? (
        <section className="grid gap-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
            {t('importPreview.notebook.cellSnippetsTitle')}
          </div>
          <ul
            role="list"
            data-testid="import-preview-notebook-snippets"
            className="grid gap-1"
          >
            {cellSnippets.map((snippet, idx) => (
              <li
                key={`snippet-${idx}`}
                data-cell-kind={snippet.kind}
                className="rounded border border-border/40 bg-background-elevated/50 p-2"
              >
                <CellSnippetRow snippet={snippet} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CellSnippetRow({ snippet }: { snippet: IpynbCellSnippet }) {
  const { t } = useTranslation();
  const isCode = snippet.kind === 'code';
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex h-4 items-center rounded px-1.5 text-[9px] font-bold uppercase tracking-wider ring-1',
            isCode && snippet.language
              ? LANGUAGE_TONE[snippet.language] ??
                  'bg-slate-500/15 text-muted ring-slate-500/30'
              : 'bg-slate-500/15 text-muted ring-slate-500/30'
          )}
        >
          {isCode
            ? t('importPreview.notebook.cellSnippetCode', {
                language: snippet.language
                  ? LANGUAGE_LABEL[snippet.language] ?? snippet.language
                  : 'JS',
              })
            : t('importPreview.notebook.cellSnippetMarkdown')}
        </span>
        {isCode && snippet.outputCount !== undefined && snippet.outputCount > 0 ? (
          <span className="text-[10px] text-muted">
            ({snippet.outputCount})
          </span>
        ) : null}
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-foreground">
        {snippet.preview.length > 0 ? snippet.preview : '(empty)'}
      </pre>
    </div>
  );
}
