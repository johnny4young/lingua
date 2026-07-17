/**
 * RL-097 Slice 1 — Right column: response preview.
 *
 * FASE 3 (MOV.02/03) — converged the bespoke status/meta/tabs bar onto
 * the shared `<ResultHeader>` primitive and the no-response / loading
 * states onto `<EmptyState>`, matching the Signal-Slate proto
 * (`proto-workspaces.jsx` httpWs: shared result header `200 OK` +
 * `245 ms · 83 B` + Body/Headers/Raw + Pretty; EmptyState "No request
 * sent yet" / CTA Send request). The body renderers, the typed-failure
 * error bands, the pretty/raw toggle, and every data-testid survive
 * verbatim — only the chrome changes.
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

import { Loader2, SendHorizontal, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  runAssertions,
  type HttpAssertion,
  type HttpResponseV1,
} from '../../../shared/httpWorkspace';
import { ExplainErrorButton } from '../AI/ExplainErrorButton';
import { EmptyState } from '../ui/EmptyState';
import { ResultHeader, type ResultHeaderTab } from '../ui/ResultHeader';
import { cn } from '../../utils/cn';
import { HttpStatusPill } from './HttpStatusPill';

type PreviewTab = 'body' | 'headers' | 'raw';

/** Escape a user string for use as a literal in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `text` on every (case-insensitive) occurrence of `query`,
 * returning alternating non-match / match segments so the renderer can
 * wrap matches in a highlight `<mark>`. Returns a single non-match
 * segment when the query is empty or never matches.
 */
function splitForHighlight(
  text: string,
  query: string
): Array<{ text: string; match: boolean }> {
  if (query.length === 0) return [{ text, match: false }];
  const re = new RegExp(escapeRegExp(query), 'gi');
  const segments: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, m.index), match: false });
    }
    segments.push({ text: m[0], match: true });
    lastIndex = m.index + m[0].length;
    // Guard against zero-length matches (escaped query never produces
    // one, but be defensive against an infinite loop).
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), match: false });
  }
  return segments;
}

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
  /**
   * T19 — a one-line `METHOD url` summary of the active request. Lets a
   * failed request (CORS / network / timeout) offer the AI "Explain this
   * error" trigger with the request as the code context.
   */
  requestSummary?: string;
  /** SR-27 — the active request's assertions, evaluated against the response. */
  assertions?: readonly HttpAssertion[];
}

export function HttpResponsePreview({
  response,
  isExecuting,
  requestSummary,
  assertions,
}: HttpResponsePreviewProps) {
  const { t } = useTranslation();
  // SR-27 — evaluate assertions against the settled response. Enabled
  // rows only; disabled rows are excluded by runAssertions.
  const assertionResults = useMemo(() => {
    if (!response || !assertions || assertions.length === 0) return [];
    return runAssertions(response, assertions);
  }, [response, assertions]);
  const assertionPassCount = assertionResults.filter((r) => r.pass).length;
  const [tab, setTab] = useState<PreviewTab>('body');
  // Fold E — pretty/raw toggle.
  const [prettyJson, setPrettyJson] = useState<boolean>(true);
  // Response body search/filter (Body tab). Highlights matches inline.
  const [search, setSearch] = useState<string>('');

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

  const responseTabs = useMemo<ReadonlyArray<ResultHeaderTab>>(
    () =>
      (['body', 'headers', 'raw'] as const).map((tabId) => ({
        id: tabId,
        label: t(`httpWorkspace.response.tab.${tabId}`),
      })),
    [t]
  );

  if (isExecuting && !response) {
    return (
      <div
        data-testid="http-response-preview"
        data-state="executing"
        className="flex h-full flex-col items-center justify-center px-4 py-6"
      >
        <EmptyState
          icon={<Loader2 size={18} className="animate-spin" aria-hidden="true" />}
          title={t('httpWorkspace.response.loading')}
          description={t('httpWorkspace.response.empty.body')}
        />
      </div>
    );
  }

  if (!response) {
    return (
      <div
        data-testid="http-response-preview"
        data-state="empty"
        className="flex h-full flex-col items-center justify-center px-4 py-6"
      >
        <EmptyState
          icon={<SendHorizontal size={18} aria-hidden="true" />}
          title={t('httpWorkspace.response.empty.title')}
          description={t('httpWorkspace.response.empty.body')}
        />
      </div>
    );
  }

  // Mono meta line: `245 ms · 83 B`, matching the proto's shared
  // result header (timing first, then size).
  const meta = `${response.durationMs} ms · ${formatBytes(response.sizeBytes)}`;
  const prettyToggleVisible =
    tab === 'body' && isJsonContentType(response.contentType);

  // The text the Body tab renders (pretty JSON when toggled, else raw).
  const displayedBody = prettyBody !== null ? prettyBody : response.body;
  const trimmedSearch = search.trim();
  const bodySegments =
    tab === 'body' && imageSrc === null && trimmedSearch.length > 0
      ? splitForHighlight(displayedBody, trimmedSearch)
      : null;
  const matchCount = bodySegments
    ? bodySegments.reduce((n, seg) => n + (seg.match ? 1 : 0), 0)
    : 0;
  // The search box only makes sense for a textual body.
  const searchVisible = tab === 'body' && imageSrc === null;

  return (
    <div
      data-testid="http-response-preview"
      data-state="loaded"
      data-response-kind={response.kind}
      className="flex h-full min-w-0 flex-col overflow-hidden"
    >
      <ResultHeader
        status={<HttpStatusPill response={response} />}
        meta={meta}
        tabs={responseTabs}
        activeTab={tab}
        onTabChange={(id) => setTab(id as PreviewTab)}
        trailing={
          <span className="flex items-center gap-2">
            {prettyToggleVisible ? (
              <label className="inline-flex items-center gap-1.5 text-caption text-fg-subtle">
                <input
                  type="checkbox"
                  checked={prettyJson}
                  onChange={(event) => setPrettyJson(event.target.checked)}
                  data-testid="http-response-preview-pretty-toggle"
                />
                {t('httpWorkspace.response.body.pretty')}
              </label>
            ) : null}
            {response.redactedHeaders.length > 0 ? (
              <span
                data-testid="http-response-preview-redacted-badge"
                className="rounded-sm bg-warning-bg px-1.5 py-0.5 text-eyebrow font-semibold text-warning-fg"
              >
                {t('httpWorkspace.response.redactedHeaders.badge', {
                  count: response.redactedHeaders.length,
                })}
              </span>
            ) : null}
          </span>
        }
      />

      {/* SR-27 — assertion results strip. Only shown when the request has
          enabled assertions; a green/red summary plus a per-row verdict. */}
      {assertionResults.length > 0 ? (
        <div
          data-testid="http-response-assertions"
          data-all-passed={assertionPassCount === assertionResults.length}
          className="border-b border-border-subtle bg-bg-panel-alt px-3 py-2"
        >
          <div
            data-testid="http-response-assertions-summary"
            className={cn(
              'text-caption font-semibold',
              assertionPassCount === assertionResults.length
                ? 'text-success-fg'
                : 'text-error-fg'
            )}
          >
            {t('httpWorkspace.editor.assert.results.summary', {
              passed: assertionPassCount,
              total: assertionResults.length,
            })}
          </div>
          <ul role="list" className="mt-1 flex flex-col gap-0.5">
            {assertionResults.map((result) => (
              <li
                key={result.id}
                data-testid="http-response-assertion-row"
                data-pass={result.pass}
                className="flex items-center gap-2 font-mono text-eyebrow"
              >
                <span
                  className={cn(
                    'rounded-sm px-1 py-0.5 font-semibold',
                    result.pass
                      ? 'bg-success-bg text-success-fg'
                      : 'bg-error-bg text-error-fg'
                  )}
                >
                  {result.pass
                    ? t('httpWorkspace.editor.assert.results.pass')
                    : t('httpWorkspace.editor.assert.results.fail')}
                </span>
                <span className="text-fg-subtle">
                  {result.actual === null
                    ? t('httpWorkspace.editor.assert.results.miss')
                    : t('httpWorkspace.editor.assert.results.actual', {
                        actual: result.actual,
                      })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Error band for typed failures — gives the user actionable copy. */}
      {response.kind === 'cors-error' ||
      response.kind === 'network-error' ||
      response.kind === 'timeout' ? (
        <div
          data-testid="http-response-preview-error"
          className="border-b border-warning-border bg-warning-bg px-3 py-2 text-caption text-warning-fg"
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
              className="ml-2 underline underline-offset-2 hover:text-warning-fg/80"
            >
              {t('httpWorkspace.openExternal.cta')}
            </button>
          ) : null}
          {requestSummary ? (
            <div className="mt-2">
              <ExplainErrorButton
                errorMessage={`HTTP request failed (${response.kind})${
                  response.errorMessage ? `: ${response.errorMessage}` : ''
                }`}
                code={requestSummary}
                language="http"
                testId="http-explain-error"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {response.kind === 'too-large' ? (
        <div
          data-testid="http-response-preview-too-large"
          className="border-b border-warning-border bg-warning-bg px-3 py-2 text-caption text-warning-fg"
        >
          {t('httpWorkspace.response.error.tooLarge')}
        </div>
      ) : null}

      {/* Body search / filter — highlights matches inline. */}
      {searchVisible ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-1.5">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('httpWorkspace.response.search.placeholder')}
            aria-label={t('httpWorkspace.response.search.ariaLabel')}
            data-testid="http-response-preview-search"
            className="h-6 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
          {trimmedSearch.length > 0 ? (
            <span
              data-testid="http-response-preview-search-count"
              className="shrink-0 font-mono text-eyebrow tabular-nums text-fg-subtle"
            >
              {t('httpWorkspace.response.search.matches', { count: matchCount })}
            </span>
          ) : null}
          {search.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={t('httpWorkspace.response.search.clear')}
              title={t('httpWorkspace.response.search.clear')}
              data-testid="http-response-preview-search-clear"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

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
              className="whitespace-pre-wrap break-words font-mono text-caption leading-relaxed"
            >
              {bodySegments !== null
                ? bodySegments.map((seg, i) =>
                    seg.match ? (
                      <mark
                        key={i}
                        data-testid="http-response-preview-body-match"
                        className="rounded-sm bg-warning-bg text-warning-fg"
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      <Fragment key={i}>{seg.text}</Fragment>
                    )
                  )
                : displayedBody}
            </pre>
          )
        ) : null}

        {tab === 'headers' ? (
          <ul
            role="list"
            data-testid="http-response-preview-headers"
            className="flex flex-col gap-1 text-caption"
          >
            {response.headers.length === 0 ? (
              <li className="text-fg-subtle">
                {t('httpWorkspace.response.headers.empty')}
              </li>
            ) : null}
            {response.headers.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold text-fg-subtle">{h.name}:</span>
                <span className={h.redacted ? 'italic text-warning-fg' : ''}>
                  {h.value}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === 'raw' ? (
          <pre
            data-testid="http-response-preview-raw"
            className="whitespace-pre-wrap break-words font-mono text-caption leading-relaxed"
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
