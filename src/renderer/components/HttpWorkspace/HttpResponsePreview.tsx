/**
 * Right column: response preview.
 *
 * The shared `<ResultHeader>` carries status, `245 ms · 83 B` and the
 * Body / Headers / Raw / Timing tabs (Snapshot with its Labs flag); the no-response and loading states use
 * `<EmptyState>`. Search, Wrap and Pretty sit in a row under the header.
 *
 * The Body view picks the renderer based on content-type:
 *
 *   - `application/json` (+ variants) → foldable tree (`HttpJsonTree`);
 *     Pretty off, or a body nested too deep to draw, shows the raw text.
 *   - `text/*` → raw text.
 *   - `image/*` → `<img>` from a data URL (the viewer only supports the
 *     happy-path where the body decoded as UTF-8 is a valid image —
 *     base64 / binary streams are deferred).
 *   - Anything else → raw text fallback.
 *
 * pretty/raw toggle on the Body tab. The toggle stays
 * local state (resetting on tab change is the desired UX).
 *
 * `<HttpStatusPill>` renders the status color-coded.
 */

import { Loader2, SendHorizontal, X } from 'lucide-react';
import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { runAssertions } from '../../../shared/httpWorkspaceAssertions';
import type {
  HttpAssertion,
  HttpCaptureRule,
  HttpResponseV1,
} from '../../../shared/httpWorkspaceSchema';
import { ExplainErrorButton } from '../AI/ExplainErrorButton';
import { EmptyState } from '../ui/EmptyState';
import { ResultHeader, type ResultHeaderTab } from '../ui/ResultHeader';
import { cn } from '../../utils/cn';
import '../../i18n/httpBuilderCatalog';
import { HttpStatusPill } from './HttpStatusPill';
import { HttpJsonTree } from './HttpJsonTree';
import { HttpResponseDelta, HttpTimingPanel } from './HttpTimingPanel';
import { HttpSnapshotPanel } from './HttpSnapshotPanel';
import { snapshotChanges, suggestAssertions } from '../../../shared/httpSnapshot';
import type { HttpResponseSnapshot } from '../../../shared/httpWorkspaceSchema';
import { capturedByPath, nestsDeeperThan, parseJsonBody, searchJson, TREE_DEPTH_LIMIT, type JsonSegment } from './httpJsonTreeModel';
import { splitForHighlight } from './httpTextHighlight';

type PreviewTab = 'body' | 'headers' | 'raw' | 'timing' | 'snapshot';

/** With snapshot assertions on: the request's snapshot and the ways to change it. */
interface HttpResponseSnapshots {
  snapshot: HttpResponseSnapshot | undefined;
  onChange: (snapshot: HttpResponseSnapshot | undefined) => void;
  onAddAssertion: (assertion: Omit<HttpAssertion, 'id'>) => void;
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
   * A one-line `METHOD url` summary of the active request. Lets a
   * failed request (CORS / network / timeout) offer the AI "Explain this
   * error" trigger with the request as the code context.
   */
  requestSummary?: string;
  /** The active request's assertions, evaluated against the response. */
  assertions?: readonly HttpAssertion[];
  /** The response before this one for the same request, for the header's change in time. */
  previous?: HttpResponseV1;
  /** The active request's capture rules; their body paths are marked in the tree. */
  captures?: readonly HttpCaptureRule[];
  /** Adds a body capture rule for a value hovered in the tree. */
  onCaptureValue?: (path: string, segments: readonly JsonSegment[]) => void;
  snapshots?: HttpResponseSnapshots;
}

export function HttpResponsePreview({
  response,
  isExecuting,
  requestSummary,
  assertions,
  previous,
  captures,
  onCaptureValue,
  snapshots,
}: HttpResponsePreviewProps) {
  const { t } = useTranslation();
  // Evaluate assertions against the settled response. Enabled
  // rows only; disabled rows are excluded by runAssertions.
  const assertionResults = useMemo(() => {
    if (!response || !assertions || assertions.length === 0) return [];
    return runAssertions(response, assertions);
  }, [response, assertions]);
  // A pending snapshot diff counts as one more failed check.
  const snapshot = snapshots?.snapshot;
  const changes = useMemo(() => (snapshot && response ? snapshotChanges(snapshot, response) : []), [snapshot, response]);
  const checkCount = assertionResults.length + (snapshot ? 1 : 0);
  const assertionPassCount = assertionResults.filter((r) => r.pass).length + (snapshot && changes.length === 0 ? 1 : 0);
  const suggestions = useMemo(
    () => (snapshots && response?.kind === 'success' ? suggestAssertions(response, assertions ?? []) : []),
    [snapshots, response, assertions]
  );
  const [selectedTab, setTab] = useState<PreviewTab>('body');
  const tab = selectedTab === 'snapshot' && !snapshots ? 'body' : selectedTab;
  // The response whose snapshot diff was rejected, kept across tab switches.
  const [rejectedAt, setRejectedAt] = useState<string | null>(null);
  // pretty/raw toggle.
  const [prettyJson, setPrettyJson] = useState<boolean>(true);
  // Off by default: long values scroll instead of wrapping back to column 0.
  const [wrap, setWrap] = useState<boolean>(false);
  // Response body search/filter (Body tab). Highlights matches inline.
  const [search, setSearch] = useState<string>('');
  const deferredSearch = useDeferredValue(search.trim());

  const parsedBody = useMemo(() => {
    if (!response || !isJsonContentType(response.contentType) || !prettyJson) return null;
    const parsed = parseJsonBody(response.body);
    return parsed && !nestsDeeperThan(parsed.value, TREE_DEPTH_LIMIT) ? parsed : null;
  }, [response, prettyJson]);
  const treeSearch = useMemo(
    () => (parsedBody ? searchJson(parsedBody.value, deferredSearch) : null),
    [parsedBody, deferredSearch]
  );
  const captured = useMemo(() => capturedByPath(captures), [captures]);
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
      ([...(['body', 'headers', 'raw', 'timing'] as const), ...(snapshots ? (['snapshot'] as const) : [])]).map((tabId) => ({
        id: tabId,
        label: t(`httpWorkspace.response.tab.${tabId}`),
      })),
    [t, snapshots]
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
        />
      </div>
    );
  }

  // Mono meta line: `245 ms · 83 B`, matching the proto's shared
  // result header (timing first, then size).
  const meta = `${response.durationMs} ms · ${formatBytes(response.sizeBytes)}${
    response.messageCount !== undefined
      ? ` · ${t('httpWorkspace.response.messages', { count: response.messageCount })}`
      : ''
  }`;
  const prettyToggleVisible =
    tab === 'body' && isJsonContentType(response.contentType);
  const wrapToggleVisible = (tab === 'body' && imageSrc === null) || tab === 'raw';
  const textClass = cn(
    'font-mono text-caption leading-relaxed',
    wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'
  );

  const trimmedSearch = search.trim();
  const bodySegments =
    tab === 'body' && imageSrc === null && parsedBody === null && trimmedSearch.length > 0
      ? splitForHighlight(response.body, trimmedSearch)
      : null;
  const matchCount = treeSearch
    ? treeSearch.count
    : bodySegments
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
        metaTrailing={<HttpResponseDelta response={response} previous={previous} />}
        className="flex-wrap gap-y-1.5"
        tabs={responseTabs}
        activeTab={tab}
        onTabChange={(id) => setTab(id as PreviewTab)}
        trailing={
          <span className="flex items-center gap-2">
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

      {/* Results strip: shown when the request has enabled assertions or a
          snapshot, which counts as one more check. */}
      {checkCount > 0 ? (
        <div
          data-testid="http-response-assertions"
          data-all-passed={assertionPassCount === checkCount}
          className="border-b border-border-subtle bg-bg-panel-alt px-3 py-2"
        >
          <div
            data-testid="http-response-assertions-summary"
            className={cn(
              'text-caption font-semibold',
              assertionPassCount === checkCount
                ? 'text-success-fg'
                : 'text-error-fg'
            )}
          >
            {t('httpWorkspace.editor.assert.results.summary', {
              passed: assertionPassCount,
              total: checkCount,
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
            {snapshot ? (
              <li data-testid="http-response-snapshot-row" data-pass={changes.length === 0} className="flex items-center gap-2 font-mono text-eyebrow">
                <span className={cn('rounded-sm px-1 py-0.5 font-semibold', changes.length === 0 ? 'bg-success-bg text-success-fg' : 'bg-error-bg text-error-fg')}>
                  {t(changes.length === 0 ? 'httpWorkspace.editor.assert.results.pass' : 'httpWorkspace.editor.assert.results.fail')}
                </span>
                <span className="text-fg-subtle">
                  {changes.length === 0 ? t('httpWorkspace.snapshot.matches') : t('httpWorkspace.snapshot.changes', { count: changes.length })}
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {suggestions.length > 0 && snapshots ? (
        <div data-testid="http-response-suggestions" className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-3 py-2">
          <span className="text-eyebrow font-semibold uppercase tracking-wide text-fg-subtle">{t('httpWorkspace.snapshot.suggested')}</span>
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.source}:${suggestion.path}:${suggestion.comparator}`}
              type="button"
              data-testid="http-response-suggestion"
              onClick={() => snapshots.onAddAssertion(suggestion)}
              className="focus-ring rounded-md border border-border-subtle px-2 py-0.5 font-mono text-eyebrow text-fg-muted hover:bg-bg-inset hover:text-fg-base"
            >
              {`+ ${t(`httpWorkspace.editor.assert.source.${suggestion.source === 'body-json' ? 'bodyJson' : suggestion.source === 'response-time' ? 'responseTime' : suggestion.source}`)}${suggestion.path ? ` ${suggestion.path}` : ''} ${t(`httpWorkspace.editor.assert.cmp.${suggestion.comparator}`)} ${suggestion.expected}`}
            </button>
          ))}
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

      {/* Body search, then the view toggles: kept out of the header so the status never shrinks. */}
      {wrapToggleVisible ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-1.5">
          {searchVisible ? (
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('httpWorkspace.response.search.placeholder')}
              aria-label={t('httpWorkspace.response.search.ariaLabel')}
              data-testid="http-response-preview-search"
              className="h-6 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            />
          ) : (
            <span className="flex-1" />
          )}
          {searchVisible && trimmedSearch.length > 0 ? (
            <span
              data-testid="http-response-preview-search-count"
              className="shrink-0 font-mono text-eyebrow tabular-nums text-fg-subtle"
            >
              {t('httpWorkspace.response.search.matches', { count: matchCount })}
            </span>
          ) : null}
          {searchVisible && search.length > 0 ? (
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
          <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-caption text-fg-subtle">
            <input
              type="checkbox"
              checked={wrap}
              onChange={(event) => setWrap(event.target.checked)}
              data-testid="http-response-preview-wrap-toggle"
            />
            {t('httpWorkspace.response.body.wrap')}
          </label>
          {prettyToggleVisible ? (
            <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-caption text-fg-subtle">
              <input
                type="checkbox"
                checked={prettyJson}
                onChange={(event) => setPrettyJson(event.target.checked)}
                data-testid="http-response-preview-pretty-toggle"
              />
              {t('httpWorkspace.response.body.pretty')}
            </label>
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
          ) : parsedBody !== null && treeSearch !== null ? (
            <HttpJsonTree
              key={`${response.recordedAt}|${response.url}`}
              value={parsedBody.value}
              query={deferredSearch}
              search={treeSearch}
              wrap={wrap}
              captured={captured}
              {...(onCaptureValue ? { onCapture: onCaptureValue } : {})}
            />
          ) : (
            <pre
              data-testid="http-response-preview-body-text"
              data-mode="raw"
              data-wrap={wrap}
              className={textClass}
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
                : response.body}
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

        {tab === 'snapshot' && snapshots ? (
          <HttpSnapshotPanel
            response={response}
            snapshot={snapshot}
            changes={changes}
            onChange={snapshots.onChange}
            rejected={rejectedAt === response.recordedAt}
            onReject={() => setRejectedAt(response.recordedAt)}
          />
        ) : null}

        {tab === 'timing' ? (
          <HttpTimingPanel response={response} desktop={typeof window !== 'undefined' && Boolean(window.lingua?.http)} />
        ) : null}

        {tab === 'raw' ? (
          <pre
            data-testid="http-response-preview-raw"
            data-wrap={wrap}
            className={textClass}
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
