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
import { Lock } from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import { BASELINE_SENSITIVE_HEADERS } from '../../../shared/httpWorkspace';
import type { CurlImporterPreview } from '../../../shared/importers/curlImporter';
import type {
  IpynbCellSnippet,
  IpynbImporterPreview,
} from '../../../shared/importers/ipynbImporter';
import type {
  CollectionImporterPreview,
  ParsedCollectionRequest,
} from '../../../shared/importers/postmanImporter';
import { languageBadgeClass } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';

export type ImportPreviewBodyShape =
  | (CurlImporterPreview & { readonly kind: 'curl-http' })
  | IpynbImporterPreview
  | CollectionImporterPreview;

export interface ImportPreviewBodyProps {
  preview: ImportPreviewBodyShape;
}

// HTTP-verb color-coding is a domain convention (GET/POST/PUT/DELETE),
// but the hues now resolve through the DS status-token families so the
// chip stays on-system in both themes — same tones HttpStatusPill /
// StatusBadge use. GET→info, POST→success, PUT/PATCH→warning,
// DELETE→error, HEAD/OPTIONS→neutral. The fallback (NEUTRAL_METHOD_TONE)
// covers any verb not listed.
const NEUTRAL_METHOD_TONE = 'bg-bg-panel-alt text-fg-muted ring-border-subtle';
const METHOD_TONE: Record<string, string> = {
  GET: 'bg-info-bg text-info-fg ring-info-border',
  POST: 'bg-success-bg text-success-fg ring-success-border',
  PUT: 'bg-warning-bg text-warning-fg ring-warning-border',
  PATCH: 'bg-warning-bg text-warning-fg ring-warning-border',
  DELETE: 'bg-error-bg text-error-fg ring-error-border',
  HEAD: NEUTRAL_METHOD_TONE,
  OPTIONS: NEUTRAL_METHOD_TONE,
};

const REDACTED_PLACEHOLDER = '<redacted>';

const LANGUAGE_LABEL: Record<string, string> = {
  javascript: 'JS',
  typescript: 'TS',
  python: 'PY',
};

export function ImportPreviewBody({ preview }: ImportPreviewBodyProps) {
  if (preview.kind === 'ipynb-notebook') {
    return <NotebookPreviewBand preview={preview} />;
  }
  if (preview.kind === 'http-collection') {
    return <CollectionPreviewBand preview={preview} />;
  }
  return <CurlPreviewBand preview={preview} />;
}

/** Count of headers whose name is a baseline-sensitive header (their
 * values are redacted on display; originals round-trip on confirm). */
function countSensitiveHeaders(request: ParsedCollectionRequest): number {
  return request.headers.filter((h) =>
    (BASELINE_SENSITIVE_HEADERS as readonly string[]).includes(
      h.name.toLowerCase()
    )
  ).length;
}

// ---------------------------------------------------------------------------
// Slice 1 — cURL preview
// ---------------------------------------------------------------------------

function CurlPreviewBand({ preview }: { preview: CurlImporterPreview }) {
  const { t } = useTranslation();
  const { redacted } = preview;
  const methodTone = METHOD_TONE[redacted.method] ?? NEUTRAL_METHOD_TONE;
  const hasRedactedHeader = redacted.headers.some(
    (h) => h.value === REDACTED_PLACEHOLDER
  );

  return (
    <div
      data-testid="import-preview-body"
      data-preview-kind="curl-http"
      className="grid gap-3 rounded-md border border-border-subtle bg-bg-inset p-3"
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
          className="min-w-0 flex-1 truncate font-mono text-xs text-fg-base"
          title={redacted.url}
        >
          {redacted.url}
        </span>
      </header>

      {redacted.headers.length > 0 ? (
        <section className="grid gap-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
            {t('importPreview.preview.headersLabel')}
            <span className="ml-2 text-fg-subtle/70">({redacted.headers.length})</span>
          </div>
          <ul
            role="list"
            data-testid="import-preview-headers"
            className="grid gap-0.5 rounded border border-border-subtle bg-bg-panel p-2"
          >
            {redacted.headers.map((header, idx) => {
              const isRedacted = header.value === REDACTED_PLACEHOLDER;
              return (
                <li
                  key={`${header.name}-${idx}`}
                  data-redacted={isRedacted}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <span className="min-w-[120px] shrink-0 truncate text-fg-subtle">
                    {header.name}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      isRedacted
                        ? 'inline-flex items-center gap-1 text-warning-fg'
                        : 'text-fg-base'
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
              className="text-[10px] text-fg-subtle"
            >
              {t('importPreview.preview.redactedHeaderHint')}
            </p>
          ) : null}
        </section>
      ) : null}

      {redacted.body ? (
        <section className="grid gap-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
            {t('importPreview.preview.bodyLabel')}
            <span className="ml-2 text-fg-subtle/70">({redacted.body.kind})</span>
          </div>
          <pre
            data-testid="import-preview-body-content"
            className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded bg-bg-panel p-2 font-mono text-[10px] text-fg-base"
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
      className="grid gap-3 rounded-md border border-border-subtle bg-bg-inset p-3"
    >
      <header className="flex items-center gap-2">
        <span data-testid="import-preview-ipynb-badge" className="inline-flex">
          <StatusBadge tone="info">{t('importPreview.notebook.badge')}</StatusBadge>
        </span>
        <span
          data-testid="import-preview-notebook-title"
          className="min-w-0 flex-1 truncate font-mono text-xs text-fg-base"
          title={title}
        >
          {title}
        </span>
      </header>

      <section className="flex flex-wrap items-center gap-2">
        <span data-testid="import-preview-notebook-summary" className="inline-flex">
          <StatusBadge tone="neutral">
            {t('importPreview.notebook.summary', {
              cells: cellCounts.total,
              code: cellCounts.code,
              markdown: cellCounts.markdown,
            })}
          </StatusBadge>
        </span>
        <span data-testid="import-preview-notebook-language" className="inline-flex">
          <StatusBadge tone="neutral">
            {dominantLanguage
              ? t('importPreview.notebook.dominantLanguage', {
                  language: LANGUAGE_LABEL[dominantLanguage] ?? dominantLanguage,
                })
              : t('importPreview.notebook.dominantLanguageMixed')}
          </StatusBadge>
        </span>
        {cellCounts.droppedRaw > 0 ? (
          <span data-testid="import-preview-notebook-dropped" className="inline-flex">
            <StatusBadge tone="warning">
              {t('importPreview.notebook.droppedRawCells', {
                count: cellCounts.droppedRaw,
              })}
            </StatusBadge>
          </span>
        ) : null}
      </section>

      {cellSnippets.length > 0 ? (
        <section className="grid gap-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
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
                className="rounded border border-border-subtle bg-bg-panel p-2"
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
            'inline-flex h-4 items-center rounded px-1.5 text-[9px] font-bold uppercase tracking-wider',
            isCode && snippet.language
              ? languageBadgeClass(snippet.language)
              : 'bg-bg-panel-alt text-fg-muted'
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
          <span className="text-[10px] text-fg-subtle">
            ({snippet.outputCount})
          </span>
        ) : null}
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-fg-base">
        {snippet.preview.length > 0 ? snippet.preview : '(empty)'}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slice 3 — Postman / Bruno collection preview
// ---------------------------------------------------------------------------

function CollectionPreviewBand({
  preview,
}: {
  preview: CollectionImporterPreview;
}) {
  const { t } = useTranslation();
  const { source, title, requests, counts } = preview;
  const badgeLabel =
    source === 'bruno'
      ? t('importPreview.collection.badgeBruno')
      : t('importPreview.collection.badgePostman');

  return (
    <div
      data-testid="import-preview-body"
      data-preview-kind="http-collection"
      data-collection-source={source}
      className="grid gap-3 rounded-md border border-border-subtle bg-bg-inset p-3"
    >
      <header className="flex items-center gap-2">
        <span data-testid="import-preview-collection-badge" className="inline-flex">
          <StatusBadge tone="info">{badgeLabel}</StatusBadge>
        </span>
        <span
          data-testid="import-preview-collection-title"
          className="min-w-0 flex-1 truncate font-mono text-xs text-fg-base"
          title={title}
        >
          {title}
        </span>
      </header>

      <section className="flex flex-wrap items-center gap-2">
        <span data-testid="import-preview-collection-summary" className="inline-flex">
          <StatusBadge tone="neutral">
            {t('importPreview.collection.summary', {
              requests: counts.total,
              folders: counts.folders,
            })}
          </StatusBadge>
        </span>
        {counts.truncated > 0 ? (
          <span data-testid="import-preview-collection-truncated" className="inline-flex">
            <StatusBadge tone="warning">
              {t('importPreview.collection.truncated', {
                count: counts.truncated,
              })}
            </StatusBadge>
          </span>
        ) : null}
        {counts.variablesResolved !== undefined && counts.variablesResolved > 0 ? (
          <span data-testid="import-preview-collection-variables" className="inline-flex">
            <StatusBadge tone="success">
              {t('importPreview.collection.variablesResolved', {
                count: counts.variablesResolved,
              })}
            </StatusBadge>
          </span>
        ) : null}
      </section>

      <section className="grid gap-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
          {t('importPreview.collection.requestsTitle')}
        </div>
        <ul
          role="list"
          data-testid="import-preview-collection-requests"
          className="grid max-h-[260px] gap-1 overflow-auto rounded border border-border-subtle bg-bg-panel p-2"
        >
          {requests.map((request, idx) => (
            <li
              key={`req-${idx}`}
              data-request-method={request.method}
              className="flex items-center gap-2"
            >
              <CollectionRequestRow request={request} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CollectionRequestRow({
  request,
}: {
  request: ParsedCollectionRequest;
}) {
  const { t } = useTranslation();
  const methodTone = METHOD_TONE[request.method] ?? NEUTRAL_METHOD_TONE;
  const sensitiveCount = countSensitiveHeaders(request);
  return (
    <>
      <span
        className={cn(
          'inline-flex w-14 shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1',
          methodTone
        )}
      >
        {request.method}
      </span>
      <div className="grid min-w-0 flex-1">
        <span className="truncate text-[11px] text-fg-base" title={request.name}>
          {request.name}
        </span>
        <span
          className="truncate font-mono text-[9px] text-fg-subtle"
          title={request.url}
        >
          {request.url}
        </span>
      </div>
      {sensitiveCount > 0 ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-[9px] text-warning-fg"
          title={t('importPreview.collection.redactedHeaderHint')}
          data-testid="import-preview-collection-redacted"
        >
          <Lock size={9} aria-hidden="true" />
          {sensitiveCount}
        </span>
      ) : null}
    </>
  );
}
