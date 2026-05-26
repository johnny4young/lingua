/**
 * RL-097 Slice 1 — Right column: response preview.
 *
 * Three sub-tabs: Body / Headers / Raw. The Body view picks the
 * renderer based on content-type:
 *
 *   - `application/json` (+ variants) → JSON tree (pretty-printed
 *     via `JSON.parse` + `JSON.stringify(_, null, 2)`).
 *   - `text/*` → raw text.
 *   - `image/*` → `<img>` from a data URL (Slice 1 only supports the
 *     happy-path where the body decoded as UTF-8 is a valid image —
 *     base64 / binary streams are deferred).
 *   - Anything else → raw text fallback.
 *
 * Fold E — pretty/raw toggle on the Body tab. The toggle stays
 * local state (resetting on tab change is the desired UX).
 *
 * Fold C — `<HttpStatusPill>` renders the status color-coded.
 */

import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HttpResponseV1 } from '../../../shared/httpWorkspace';
import { cn } from '../../utils/cn';
import { HttpStatusPill } from './HttpStatusPill';

type PreviewTab = 'body' | 'headers' | 'raw';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function isJsonContentType(contentType: string): boolean {
  // `application/json`, `application/vnd.api+json`, `text/json`.
  return /\b(application|text)\/[a-z0-9.+-]*json\b/i.test(contentType);
}

function isImageContentType(contentType: string): boolean {
  return /^image\//i.test(contentType);
}

function tryPrettyJson(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

function imageDataUrl(response: HttpResponseV1): string | null {
  if (!isImageContentType(response.contentType) || response.body.length === 0) {
    return null;
  }
  try {
    const bytes = new TextEncoder().encode(response.body);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return `data:${response.contentType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function externalHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface HttpResponsePreviewProps {
  response: HttpResponseV1 | undefined;
  isExecuting: boolean;
}

export function HttpResponsePreview({
  response,
  isExecuting,
}: HttpResponsePreviewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PreviewTab>('body');
  // Fold E — pretty/raw toggle.
  const [prettyJson, setPrettyJson] = useState<boolean>(true);

  const prettyBody = useMemo(() => {
    if (!response) return null;
    if (!isJsonContentType(response.contentType)) return null;
    if (!prettyJson) return null;
    return tryPrettyJson(response.body);
  }, [response, prettyJson]);
  const imageSrc = useMemo(
    () => (response ? imageDataUrl(response) : null),
    [response]
  );
  const externalUrl = useMemo(
    () => (response ? externalHttpUrl(response.url) : null),
    [response]
  );

  if (isExecuting && !response) {
    return (
      <div
        data-testid="http-response-preview"
        data-state="executing"
        className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center text-sm text-muted"
      >
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        <span>{t('httpWorkspace.response.loading')}</span>
      </div>
    );
  }

  if (!response) {
    return (
      <div
        data-testid="http-response-preview"
        data-state="empty"
        className="flex h-full flex-col items-center justify-center gap-1 px-4 py-6 text-center"
      >
        <div className="text-sm font-medium">
          {t('httpWorkspace.response.empty.title')}
        </div>
        <div className="text-xs text-muted">
          {t('httpWorkspace.response.empty.body')}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="http-response-preview"
      data-state="loaded"
      data-response-kind={response.kind}
      className="flex h-full min-w-0 flex-col overflow-hidden"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-1.5 text-xs">
        <HttpStatusPill response={response} />
        <span className="text-muted">{formatBytes(response.sizeBytes)}</span>
        <span className="text-muted">·</span>
        <span className="text-muted tabular-nums">
          {response.durationMs} ms
        </span>
        {response.redactedHeaders.length > 0 ? (
          <span
            data-testid="http-response-preview-redacted-badge"
            className="ml-auto rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
          >
            {t('httpWorkspace.response.redactedHeaders.badge', {
              count: response.redactedHeaders.length,
            })}
          </span>
        ) : null}
      </header>

      {/* Error band for typed failures — gives the user actionable copy. */}
      {response.kind === 'cors-error' ||
      response.kind === 'network-error' ||
      response.kind === 'timeout' ? (
        <div
          data-testid="http-response-preview-error"
          className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200"
        >
          {response.kind === 'cors-error'
            ? t('httpWorkspace.response.error.cors')
            : response.kind === 'timeout'
              ? t('httpWorkspace.response.error.timeout', {
                  seconds: Math.round(response.durationMs / 1000),
                })
              : t('httpWorkspace.response.error.network')}
          {response.errorMessage ? (
            <span className="ml-1 opacity-80">{response.errorMessage}</span>
          ) : null}
          {response.kind === 'cors-error' && externalUrl !== null ? (
            <button
              type="button"
              onClick={() =>
                window.open(externalUrl, '_blank', 'noopener,noreferrer')
              }
              data-testid="http-response-preview-open-external"
              className="ml-2 underline underline-offset-2 hover:text-amber-900"
            >
              {t('httpWorkspace.openExternal.cta')}
            </button>
          ) : null}
        </div>
      ) : null}

      {response.kind === 'too-large' ? (
        <div
          data-testid="http-response-preview-too-large"
          className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200"
        >
          {t('httpWorkspace.response.error.tooLarge')}
        </div>
      ) : null}

      {/* Sub-tabs */}
      <nav
        role="tablist"
        aria-label={t('httpWorkspace.response.tabs.ariaLabel')}
        className="flex shrink-0 gap-1 border-b border-border/30 px-2 pt-1"
      >
        {(['body', 'headers', 'raw'] as const).map((tabId) => (
          <button
            key={tabId}
            type="button"
            role="tab"
            aria-selected={tab === tabId}
            onClick={() => setTab(tabId)}
            data-testid={`http-response-preview-tab-${tabId}`}
            className={cn(
              '-mb-px rounded-t-md border border-transparent px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors',
              tab === tabId
                ? 'border-border-strong border-b-background bg-background text-foreground'
                : 'text-muted hover:bg-surface-strong/40 hover:text-foreground'
            )}
          >
            {t(`httpWorkspace.response.tab.${tabId}`)}
          </button>
        ))}
        {tab === 'body' && isJsonContentType(response.contentType) ? (
          <label className="ml-auto inline-flex items-center gap-1.5 self-center text-[10px] text-muted">
            <input
              type="checkbox"
              checked={prettyJson}
              onChange={(event) => setPrettyJson(event.target.checked)}
              data-testid="http-response-preview-pretty-toggle"
            />
            {t('httpWorkspace.response.body.pretty')}
          </label>
        ) : null}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {tab === 'body' ? (
          imageSrc !== null ? (
            <img
              src={imageSrc}
              alt={t('httpWorkspace.response.body.imageAlt')}
              data-testid="http-response-preview-body-image"
              className="max-w-full"
            />
          ) : (
            <pre
              data-testid="http-response-preview-body-text"
              data-mode={prettyBody !== null ? 'pretty' : 'raw'}
              className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed"
            >
              {prettyBody !== null ? prettyBody : response.body}
            </pre>
          )
        ) : null}

        {tab === 'headers' ? (
          <ul
            role="list"
            data-testid="http-response-preview-headers"
            className="flex flex-col gap-1 text-[11px]"
          >
            {response.headers.length === 0 ? (
              <li className="text-muted">
                {t('httpWorkspace.response.headers.empty')}
              </li>
            ) : null}
            {response.headers.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold text-muted">{h.name}:</span>
                <span className={h.redacted ? 'italic text-amber-600' : ''}>
                  {h.value}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === 'raw' ? (
          <pre
            data-testid="http-response-preview-raw"
            className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed"
          >
            {`HTTP/1.1 ${response.status} ${response.statusText}\n` +
              response.headers
                .map((h) => `${h.name}: ${h.value}`)
                .join('\n') +
              '\n\n' +
              response.body}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
