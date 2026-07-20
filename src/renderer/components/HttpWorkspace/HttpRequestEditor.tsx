/**
 * implementation — Center column: edit the active request (method,
 * URL, headers, body, Send).
 *
 * HTTP workspace usability upgrade — the request builder gained
 * Insomnia-style sub-tabs (Params | Auth | Headers | Body) plus a
 * "Copy as cURL" affordance. The Params table stays in two-way sync
 * with the URL bar; the Auth tab injects an Authorization / API-key
 * header on send.
 *
 * implementation note here:
 *
 *   - **A**: Cmd/Ctrl+Enter while focus is inside any input fires
 *     the Send handler. Mirrors the run-shortcut muscle memory the
 *     scratchpad uses. The shortcut hint is surfaced inline on Send.
 *   - **B**: pasting a `curl …` command into the URL field detects
 *     the shape and offers an "Import as request?" notice. The
 *     parser handles the common cases (method via `-X`, headers via
 *     `-H`, body via `-d` / `--data`).
 *   - **D**: every keystroke debounced 500 ms auto-saves via
 *     `onPatch` — no explicit Save button.
 */

import { ChevronDown, Copy, Loader2, SendHorizontal, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HTTP_METHODS,
  MAX_REQUEST_BODY_BYTES,
  buildCurlCommand,
  createBlankAssertion,
  createBlankCaptureRule,
  paramsToUrl,
  reconcileParamsWithUrl,
  urlToParams,
  utf8ByteLength,
  type HttpAssertion,
  type HttpCaptureRule,
  type HttpMethod,
  type HttpQueryParam,
  type HttpRequestAuth,
  type HttpRequestBody,
  type HttpRequestBodyKind,
  type HttpRequestHeader,
  type HttpRequestV1,
} from '../../../shared/httpWorkspace';
import {
  HTTP_CODEGEN_TARGETS,
  HTTP_CODEGEN_LABELS,
  generateHttpCode,
  type HttpCodegenTarget,
} from '../../../shared/httpCodegen';
import { maskSecretsForCapsule, type HttpEnvironmentV1 } from '../../../shared/httpEnvironment';
import { writeToClipboard } from '../../utils/clipboard';
import { useUIStore } from '../../stores/uiStore';
import { tryParseCurl } from './curlImport';
import { HttpEnvironmentSelector } from './HttpEnvironmentSelector';
import { HttpEnvironmentPreview } from './HttpEnvironmentPreview';
import { HttpRequestBuilderTabs, type HttpRequestBuilderTab } from './HttpRequestBuilderTabs';

const AUTO_SAVE_DEBOUNCE_MS = 500;

export interface HttpRequestEditorProps {
  request: HttpRequestV1;
  /**
   * Patches land via this callback (auto-save). The target request id
   * is passed explicitly so a debounced flush always lands on the
   * entry the edit was typed into, even if the active request switched
   * during the debounce quiet window (RQ-02).
   */
  onPatch: (requestId: string, patch: Partial<HttpRequestV1>) => void;
  /** Send the current request. Caller disables during in-flight. */
  onSend: (request: HttpRequestV1) => void;
  /** Cancel the in-flight request. Optional (no-op when absent). */
  onStop?: () => void;
  isExecuting: boolean;
  /**
   * implementation — environment wiring. The selector renders in the
   * header; the resolution preview renders beneath the URL. The active
   * environment also drives the secret-safe Copy-as-cURL. Optional with
   * empty/no-op defaults so the editor still renders standalone (e.g. in
   * a focused unit test) without the environment surfaces.
   */
  environments?: ReadonlyArray<HttpEnvironmentV1>;
  activeEnvironmentId?: string | null;
  onSelectEnvironment?: (id: string | null) => void;
  onManageEnvironment?: () => void;
}

const NO_ENVIRONMENTS: ReadonlyArray<HttpEnvironmentV1> = [];

// Copy-as menu formats. Labels are library / tool names (cURL, fetch,
// axios, requests) — proper nouns, not translatable UI copy — so they
// live as constants rather than i18n keys.
const COPY_FORMATS: ReadonlyArray<{
  id: 'curl' | HttpCodegenTarget;
  label: string;
}> = [
  { id: 'curl', label: 'cURL' },
  ...HTTP_CODEGEN_TARGETS.map(target => ({
    id: target,
    label: HTTP_CODEGEN_LABELS[target],
  })),
];

export function HttpRequestEditor({
  request,
  onPatch,
  onSend,
  onStop,
  isExecuting,
  environments = NO_ENVIRONMENTS,
  activeEnvironmentId = null,
  onSelectEnvironment,
  onManageEnvironment,
}: HttpRequestEditorProps) {
  const { t } = useTranslation();

  // Local draft state. Auto-save debounce flushes to the store via
  // `onPatch` after `AUTO_SAVE_DEBOUNCE_MS` of quiet. Local state
  // avoids per-keystroke store writes (which would re-render the
  // request list among other things).
  const [url, setUrl] = useState<string>(request.url);
  const [method, setMethod] = useState<HttpMethod>(request.method);
  const [headers, setHeaders] = useState<HttpRequestHeader[]>(request.headers);
  const [body, setBody] = useState<HttpRequestBody | undefined>(request.body);
  // Params seed from the persisted `queryParams` when present, else
  // derive from the URL (back-compat: pre-feature requests carry their
  // params only in the URL string).
  const [params, setParams] = useState<HttpQueryParam[]>(
    request.queryParams ?? urlToParams(request.url)
  );
  const [auth, setAuth] = useState<HttpRequestAuth | undefined>(request.auth);
  const [captures, setCaptures] = useState<HttpCaptureRule[]>(request.captures ?? []);
  const [assertions, setAssertions] = useState<HttpAssertion[]>(request.assertions ?? []);
  const [builderTab, setBuilderTab] = useState<HttpRequestBuilderTab>('params');

  // implementation — the active environment, resolved from props.
  const activeEnv = useMemo<HttpEnvironmentV1 | null>(
    () => environments.find(e => e.id === activeEnvironmentId) ?? null,
    [environments, activeEnvironmentId]
  );

  // implementation note — a LIVE request snapshot for the
  // resolution preview, rebuilt from the in-editor draft state on every
  // keystroke (the persisted `request` lags behind the 500 ms debounce).
  const previewRequest = useMemo<HttpRequestV1>(
    () => ({
      ...request,
      method,
      url,
      headers,
      queryParams: params,
      ...(auth ? { auth } : {}),
      body: body ?? { kind: 'none' },
    }),
    [request, method, url, headers, params, auth, body]
  );

  // implementation note — debounced auto-save. One timer covers all fields so a
  // rapid edit across URL + params + headers + body settles to a
  // single patch.
  //
  // RQ-02 — the pending patch carries the id of the request it was
  // typed into (`pendingTargetIdRef`), captured at schedule time. A
  // flush always targets that captured id, never the (possibly
  // already-switched) active request, so an edit to request A can
  // never leak onto request B when the user switches inside the 500 ms
  // quiet window. `latestOnPatchRef` keeps the flush wired to the
  // current callback identity without re-arming the timer.
  const patchTimerRef = useRef<number | null>(null);
  const pendingPatchRef = useRef<Partial<HttpRequestV1> | null>(null);
  const pendingTargetIdRef = useRef<string | null>(null);
  const latestOnPatchRef = useRef(onPatch);
  useEffect(() => {
    latestOnPatchRef.current = onPatch;
  }, [onPatch]);

  // Flush any pending debounced patch to the request it was typed
  // into. Stable identity (no deps) so the unmount / switch effects
  // can call it without re-arming on every render.
  const flushPendingPatch = useCallback(() => {
    if (patchTimerRef.current !== null) {
      window.clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    const pendingPatch = pendingPatchRef.current;
    const targetId = pendingTargetIdRef.current;
    pendingPatchRef.current = null;
    pendingTargetIdRef.current = null;
    if (pendingPatch && targetId !== null) {
      latestOnPatchRef.current(targetId, pendingPatch);
    }
  }, []);

  // Sync local state when the active request switches (different id).
  // Flush the previous request's pending edit FIRST so it lands on the
  // entry it was typed into before we overwrite the draft with the
  // newly-active request (RQ-02).
  const lastRequestIdRef = useRef<string>(request.id);
  useEffect(() => {
    if (lastRequestIdRef.current === request.id) return;
    flushPendingPatch();
    lastRequestIdRef.current = request.id;
    setUrl(request.url);
    setMethod(request.method);
    setHeaders(request.headers);
    setBody(request.body);
    setParams(request.queryParams ?? urlToParams(request.url));
    setAuth(request.auth);
    setCaptures(request.captures ?? []);
    setAssertions(request.assertions ?? []);
  }, [
    request.id,
    request.url,
    request.method,
    request.headers,
    request.body,
    request.queryParams,
    request.auth,
    request.captures,
    request.assertions,
    flushPendingPatch,
  ]);

  const pushBodyTooLargeNotice = useCallback(() => {
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'httpWorkspace.editor.body.tooLarge',
    });
  }, []);

  const bodyExceedsCap = useCallback(
    (content: string): boolean => utf8ByteLength(content) > MAX_REQUEST_BODY_BYTES,
    []
  );

  const buildDraftPatch = useCallback(
    (patch: Partial<HttpRequestV1> = {}): Partial<HttpRequestV1> => ({
      method: patch.method ?? method,
      url: patch.url ?? url,
      headers: patch.headers ?? headers,
      queryParams: patch.queryParams ?? params,
      auth: patch.auth ?? auth,
      body: patch.body ?? body ?? { kind: 'none' },
      // Carry through the list fields (captures/assertions) when the
      // caller is editing them — the debounced patch is a full snapshot,
      // and omitting these dropped every capture/assertion edit before it
      // reached the store.
      ...(patch.captures !== undefined ? { captures: patch.captures } : {}),
      ...(patch.assertions !== undefined ? { assertions: patch.assertions } : {}),
    }),
    [method, url, headers, params, auth, body]
  );

  const scheduleAutoSave = useCallback(
    (patch: Partial<HttpRequestV1>) => {
      const fullPatch = buildDraftPatch(patch);
      pendingPatchRef.current = fullPatch;
      // Capture the id of the request being edited NOW. The flush reads
      // this captured id, so a switch before the timer fires cannot
      // redirect the patch onto the newly-active request (RQ-02).
      pendingTargetIdRef.current = request.id;
      if (patchTimerRef.current !== null) {
        window.clearTimeout(patchTimerRef.current);
      }
      patchTimerRef.current = window.setTimeout(() => {
        flushPendingPatch();
      }, AUTO_SAVE_DEBOUNCE_MS);
    },
    [buildDraftPatch, flushPendingPatch, request.id]
  );

  const buildDraftRequest = useCallback((): HttpRequestV1 => {
    return {
      ...request,
      method,
      url,
      headers,
      queryParams: params,
      ...(auth ? { auth } : {}),
      body: body ?? { kind: 'none' },
      captures,
      assertions,
    };
  }, [request, method, url, headers, params, auth, body, captures, assertions]);

  const flushDraftBeforeSend = useCallback((): HttpRequestV1 | null => {
    const draft = buildDraftRequest();
    const content = draft.body?.kind !== 'none' ? (draft.body?.content ?? '') : '';
    if (content.length > 0 && bodyExceedsCap(content)) {
      pushBodyTooLargeNotice();
      return null;
    }
    // Drop any pending debounced patch (its content is subsumed by the
    // synchronous flush below) and persist the draft straight to the
    // request being sent.
    if (patchTimerRef.current !== null) {
      window.clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    pendingPatchRef.current = null;
    pendingTargetIdRef.current = null;
    onPatch(request.id, {
      method: draft.method,
      url: draft.url,
      headers: draft.headers,
      queryParams: draft.queryParams,
      ...(draft.auth ? { auth: draft.auth } : {}),
      body: draft.body,
      captures: draft.captures,
      assertions: draft.assertions,
    });
    return draft;
  }, [buildDraftRequest, bodyExceedsCap, onPatch, pushBodyTooLargeNotice, request.id]);

  const sendCurrentDraft = useCallback(() => {
    if (isExecuting) return;
    const draft = flushDraftBeforeSend();
    if (!draft) return;
    onSend(draft);
  }, [flushDraftBeforeSend, isExecuting, onSend]);

  // Copy as cURL — build a shell command from the resolved draft (URL
  // incl. params, composed headers incl. injected auth, body) and copy
  // it. A one-shot notice confirms / surfaces a clipboard failure.
  //
  // implementation note — when an environment is active, feed the
  // curl builder a request whose NON-secret vars are resolved (so the
  // printed command is runnable) but whose SECRET vars stay as their
  // `{{key}}` placeholder (no clipboard leak). With no env active, the
  // raw draft is printed verbatim — the "clipboard is the user's own
  // surface" philosophy still holds for manually-typed values; env
  // secrets are the documented exception.
  // Copy the request as a snippet in the chosen format. `'curl'` uses the
  // shell builder; the others go through the code generators. Secret env
  // vars are masked to `{{key}}` (never resolved into the clipboard) for
  // every format, identically to the cURL path.
  const copyAs = useCallback(
    async (format: 'curl' | HttpCodegenTarget) => {
      const draft = buildDraftRequest();
      const masked = activeEnv ? maskSecretsForCapsule(draft, activeEnv) : draft;
      const snippet =
        format === 'curl' ? buildCurlCommand(masked) : generateHttpCode(masked, format);
      const ok = await writeToClipboard(snippet);
      useUIStore.getState().pushStatusNotice({
        tone: ok ? 'success' : 'warning',
        messageKey: ok
          ? 'httpWorkspace.editor.copyCurl.copied'
          : 'httpWorkspace.editor.copyCurl.failed',
      });
    },
    [buildDraftRequest, activeEnv]
  );

  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const copyMenuRef = useRef<HTMLDivElement | null>(null);
  // Close the copy menu on outside click / Escape.
  useEffect(() => {
    if (!copyMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!copyMenuRef.current?.contains(event.target as Node)) {
        setCopyMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCopyMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [copyMenuOpen]);

  // Flush on unmount so an edit typed <500 ms before the editor
  // unmounts (tab close, panel teardown) still lands on its request.
  useEffect(() => {
    return () => {
      flushPendingPatch();
    };
  }, [flushPendingPatch]);

  // implementation note — Cmd/Ctrl+Enter sends.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      sendCurrentDraft();
    },
    [sendCurrentDraft]
  );

  // Edit the URL bar directly. Re-seed the Params table from the new
  // query string so the two views stay coherent (URL → params).
  const handleUrlChange = useCallback(
    (nextUrl: string) => {
      setUrl(nextUrl);
      // Preserve disabled ("commented out") param rows: they are not in
      // the URL, so a plain urlToParams() would drop them on the first
      // keystroke.
      const nextParams = reconcileParamsWithUrl(nextUrl, params);
      setParams(nextParams);
      scheduleAutoSave({ url: nextUrl, queryParams: nextParams });
    },
    [params, scheduleAutoSave]
  );

  // Edit a param row. Rebuild the URL from the rows so the URL bar
  // reflects the change (params → URL).
  const applyParams = useCallback(
    (nextParams: HttpQueryParam[]) => {
      const nextUrl = paramsToUrl(url, nextParams);
      setParams(nextParams);
      setUrl(nextUrl);
      scheduleAutoSave({ url: nextUrl, queryParams: nextParams });
    },
    [url, scheduleAutoSave]
  );

  const handleAddParam = useCallback(() => {
    applyParams([...params, { key: '', value: '', enabled: true }]);
  }, [params, applyParams]);

  const handleUpdateParam = useCallback(
    (index: number, patch: Partial<HttpQueryParam>) => {
      const next = params.slice();
      const current = next[index];
      if (!current) return;
      next[index] = { ...current, ...patch };
      applyParams(next);
    },
    [params, applyParams]
  );

  const handleRemoveParam = useCallback(
    (index: number) => {
      applyParams(params.filter((_, i) => i !== index));
    },
    [params, applyParams]
  );

  // Capture rules (request chaining). Local-state + debounced patch,
  // mirroring the params/headers pattern.
  const applyCaptures = useCallback(
    (nextCaptures: HttpCaptureRule[]) => {
      setCaptures(nextCaptures);
      scheduleAutoSave({ captures: nextCaptures });
    },
    [scheduleAutoSave]
  );

  const handleAddCapture = useCallback(() => {
    applyCaptures([...captures, createBlankCaptureRule()]);
  }, [captures, applyCaptures]);

  const handleUpdateCapture = useCallback(
    (index: number, patch: Partial<HttpCaptureRule>) => {
      const next = captures.slice();
      const current = next[index];
      if (!current) return;
      next[index] = { ...current, ...patch };
      applyCaptures(next);
    },
    [captures, applyCaptures]
  );

  const handleRemoveCapture = useCallback(
    (index: number) => {
      applyCaptures(captures.filter((_, i) => i !== index));
    },
    [captures, applyCaptures]
  );

  // internal — response assertions. Same local-state + debounced-patch
  // pattern as captures.
  const applyAssertions = useCallback(
    (nextAssertions: HttpAssertion[]) => {
      setAssertions(nextAssertions);
      scheduleAutoSave({ assertions: nextAssertions });
    },
    [scheduleAutoSave]
  );

  const handleAddAssertion = useCallback(() => {
    applyAssertions([...assertions, createBlankAssertion()]);
  }, [assertions, applyAssertions]);

  const handleUpdateAssertion = useCallback(
    (index: number, patch: Partial<HttpAssertion>) => {
      const next = assertions.slice();
      const current = next[index];
      if (!current) return;
      next[index] = { ...current, ...patch };
      applyAssertions(next);
    },
    [assertions, applyAssertions]
  );

  const handleRemoveAssertion = useCallback(
    (index: number) => {
      applyAssertions(assertions.filter((_, i) => i !== index));
    },
    [assertions, applyAssertions]
  );

  const handleAuthChange = useCallback(
    (nextAuth: HttpRequestAuth) => {
      setAuth(nextAuth);
      scheduleAutoSave({ auth: nextAuth });
    },
    [scheduleAutoSave]
  );

  // implementation note — cURL paste import. Listens on the URL input only.
  const handleUrlPaste = useCallback(
    (event: React.ClipboardEvent<HTMLInputElement>) => {
      const pasted = event.clipboardData.getData('text');
      if (!pasted || !/^\s*curl\s/i.test(pasted)) return;
      const parsed = tryParseCurl(pasted);
      if (!parsed) return;
      event.preventDefault();
      const parsedBody = parsed.body?.content ?? '';
      if (parsedBody.length > 0 && bodyExceedsCap(parsedBody)) {
        pushBodyTooLargeNotice();
        return;
      }
      // Offer the import via a one-shot notice so the user can
      // confirm. The action populates the editor + auto-saves.
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'httpWorkspace.curlImport.offer',
        actions: [
          {
            labelKey: 'httpWorkspace.curlImport.accept',
            onClick: () => {
              const importedParams = urlToParams(parsed.url);
              setMethod(parsed.method);
              setUrl(parsed.url);
              setParams(importedParams);
              if (parsed.headers.length > 0) setHeaders(parsed.headers);
              if (parsed.body) setBody(parsed.body);
              onPatch(request.id, {
                method: parsed.method,
                url: parsed.url,
                queryParams: importedParams,
                ...(parsed.headers.length > 0 ? { headers: parsed.headers } : {}),
                ...(parsed.body ? { body: parsed.body } : {}),
              });
            },
          },
        ],
      });
    },
    [bodyExceedsCap, onPatch, pushBodyTooLargeNotice, request.id]
  );

  const handleAddHeader = useCallback(() => {
    const next: HttpRequestHeader[] = [...headers, { name: '', value: '', enabled: true }];
    setHeaders(next);
    scheduleAutoSave({ headers: next });
  }, [headers, scheduleAutoSave]);

  const handleUpdateHeader = useCallback(
    (index: number, patch: Partial<HttpRequestHeader>) => {
      const next = headers.slice();
      const current = next[index];
      if (!current) return;
      next[index] = { ...current, ...patch };
      setHeaders(next);
      scheduleAutoSave({ headers: next });
    },
    [headers, scheduleAutoSave]
  );

  const handleRemoveHeader = useCallback(
    (index: number) => {
      const next = headers.filter((_, i) => i !== index);
      setHeaders(next);
      scheduleAutoSave({ headers: next });
    },
    [headers, scheduleAutoSave]
  );

  const handleBodyKindChange = useCallback(
    (kind: HttpRequestBodyKind) => {
      const next: HttpRequestBody = {
        kind,
        ...(kind !== 'none' ? { content: body?.content ?? '' } : {}),
      };
      setBody(next);
      scheduleAutoSave({ body: next });
    },
    [body?.content, scheduleAutoSave]
  );

  const handleBodyContentChange = useCallback(
    (content: string) => {
      if (bodyExceedsCap(content)) {
        pushBodyTooLargeNotice();
        return;
      }
      const next: HttpRequestBody = {
        kind: body?.kind ?? 'none',
        content,
      };
      setBody(next);
      scheduleAutoSave({ body: next });
    },
    [body?.kind, bodyExceedsCap, pushBodyTooLargeNotice, scheduleAutoSave]
  );

  return (
    <div
      data-testid="http-request-editor"
      onKeyDown={handleKeyDown}
      className="flex h-full min-w-0 flex-col gap-2 overflow-hidden p-3"
    >
      {/* implementation — environment selector slot, above the
          method/URL row so it reads as request-wide context. */}
      <div className="flex shrink-0 items-center justify-end">
        <HttpEnvironmentSelector
          environments={environments}
          activeEnvironmentId={activeEnvironmentId}
          onSelect={onSelectEnvironment ?? (() => undefined)}
          onManage={onManageEnvironment ?? (() => undefined)}
        />
      </div>

      {/* Method + URL row */}
      <div className="flex shrink-0 items-center gap-2">
        <label className="internal" htmlFor="http-request-method">
          {t('httpWorkspace.editor.method.label')}
        </label>
        <select
          id="http-request-method"
          data-testid="http-request-editor-method"
          value={method}
          onChange={event => {
            const next = event.target.value as HttpMethod;
            setMethod(next);
            scheduleAutoSave({ method: next });
          }}
          className="h-8 shrink-0 rounded-md border border-border bg-bg-panel px-2 font-mono text-body-sm font-semibold tabular-nums text-fg-base focus:border-border-strong focus:outline-none"
        >
          {HTTP_METHODS.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          data-testid="http-request-editor-url"
          placeholder={t('httpWorkspace.editor.url.placeholder')}
          aria-label={t('httpWorkspace.editor.url.ariaLabel')}
          value={url}
          onChange={event => handleUrlChange(event.target.value)}
          onPaste={handleUrlPaste}
          className="h-8 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-3 font-mono text-body-sm text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
        />
        {/* Copy-as menu — cURL + code snippets (fetch / axios / Python). */}
        <div ref={copyMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setCopyMenuOpen(open => !open)}
            disabled={url.trim().length === 0}
            data-testid="http-request-editor-copy-menu"
            aria-haspopup="menu"
            aria-expanded={copyMenuOpen}
            aria-label={t('httpWorkspace.editor.copyAs.label')}
            title={t('httpWorkspace.editor.copyAs.label')}
            className="focus-ring inline-flex h-8 items-center justify-center gap-0.5 rounded-md border border-border-subtle px-2 text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy size={14} aria-hidden="true" />
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {copyMenuOpen ? (
            <div
              role="menu"
              data-testid="http-request-editor-copy-menu-list"
              className="absolute right-0 top-9 z-20 min-w-[180px] overflow-hidden rounded-md border border-border-subtle bg-bg-base py-1 shadow-lg"
            >
              {COPY_FORMATS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  data-testid={`http-request-editor-copy-${id}`}
                  onClick={() => {
                    setCopyMenuOpen(false);
                    void copyAs(id);
                  }}
                  className="focus-ring block w-full px-3 py-1.5 text-left text-body-sm text-fg-base hover:bg-bg-inset focus-visible:bg-bg-inset"
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {/* FASE 3 — Send is the SLATE accent primary per the proto
            (httpWs `Btn variant="primary"`, `bg: D.acc / fg: D.onAcc`).
            Green stays reserved for SQL Run / success states. Label +
            shortcut hint show inline. */}
        {isExecuting ? (
          // In-flight → the primary button becomes Stop (cancels the
          // request; the previous response stays on screen).
          <button
            type="button"
            onClick={onStop}
            data-testid="http-request-editor-stop"
            aria-label={t('httpWorkspace.editor.stop.label')}
            title={t('httpWorkspace.editor.stop.label')}
            className="focus-ring inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border-strong bg-bg-inset px-3 text-body-sm font-semibold text-fg-base transition-colors hover:bg-bg-muted"
          >
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            <Square size={12} aria-hidden="true" />
            <span>{t('httpWorkspace.editor.stop.label')}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={sendCurrentDraft}
            disabled={url.trim().length === 0}
            data-testid="http-request-editor-send"
            aria-label={t('httpWorkspace.editor.send.label')}
            title={`${t('httpWorkspace.editor.send.label')} · ${t('httpWorkspace.editor.send.shortcutHint')}`}
            className="focus-ring inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-3 text-body-sm font-semibold text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendHorizontal size={14} aria-hidden="true" />
            <span>{t('httpWorkspace.editor.send.label')}</span>
          </button>
        )}
      </div>

      {/* implementation note — resolution preview beneath the
          URL. Resolved URL (secrets masked) + variable-state chips. */}
      <HttpEnvironmentPreview request={previewRequest} env={activeEnv} />

      <HttpRequestBuilderTabs
        method={method}
        activeTab={builderTab}
        onSelectTab={setBuilderTab}
        params={params}
        onAddParam={handleAddParam}
        onUpdateParam={handleUpdateParam}
        onRemoveParam={handleRemoveParam}
        auth={auth}
        onAuthChange={handleAuthChange}
        headers={headers}
        onAddHeader={handleAddHeader}
        onUpdateHeader={handleUpdateHeader}
        onRemoveHeader={handleRemoveHeader}
        body={body}
        onBodyKindChange={handleBodyKindChange}
        onBodyContentChange={handleBodyContentChange}
        captures={captures}
        onAddCapture={handleAddCapture}
        onUpdateCapture={handleUpdateCapture}
        onRemoveCapture={handleRemoveCapture}
        assertions={assertions}
        onAddAssertion={handleAddAssertion}
        onUpdateAssertion={handleUpdateAssertion}
        onRemoveAssertion={handleRemoveAssertion}
      />
    </div>
  );
}
