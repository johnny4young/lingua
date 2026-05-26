/**
 * RL-097 Slice 1 — Center column: edit the active request (method,
 * URL, headers, body, Send).
 *
 * Folds wired here:
 *
 *   - **A**: Cmd/Ctrl+Enter while focus is inside any input fires
 *     the Send handler. Mirrors the run-shortcut muscle memory the
 *     scratchpad uses.
 *   - **B**: pasting a `curl …` command into the URL field detects
 *     the shape and offers an "Import as request?" notice. The
 *     parser handles the common cases (method via `-X`, headers via
 *     `-H`, body via `-d` / `--data`).
 *   - **D**: every keystroke debounced 500 ms auto-saves via
 *     `onPatch` — no explicit Save button.
 */

import { Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HTTP_METHODS,
  MAX_REQUEST_BODY_BYTES,
  utf8ByteLength,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestBodyKind,
  type HttpRequestHeader,
  type HttpRequestV1,
} from '../../../shared/httpWorkspace';
import { useUIStore } from '../../stores/uiStore';
import { tryParseCurl } from './curlImport';

const AUTO_SAVE_DEBOUNCE_MS = 500;

export interface HttpRequestEditorProps {
  request: HttpRequestV1;
  /** Patches land via this callback (auto-save). */
  onPatch: (patch: Partial<HttpRequestV1>) => void;
  /** Send the current request. Caller disables during in-flight. */
  onSend: (request: HttpRequestV1) => void;
  isExecuting: boolean;
}

export function HttpRequestEditor({
  request,
  onPatch,
  onSend,
  isExecuting,
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

  // Sync local state when the active request switches (different id).
  const lastRequestIdRef = useRef<string>(request.id);
  useEffect(() => {
    if (lastRequestIdRef.current === request.id) return;
    lastRequestIdRef.current = request.id;
    setUrl(request.url);
    setMethod(request.method);
    setHeaders(request.headers);
    setBody(request.body);
  }, [request.id, request.url, request.method, request.headers, request.body]);

  // Fold D — debounced auto-save. One timer covers all four fields
  // so a rapid edit across URL + headers + body settles to a single
  // patch.
  const patchTimerRef = useRef<number | null>(null);
  const pendingPatchRef = useRef<Partial<HttpRequestV1> | null>(null);
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
      body: patch.body ?? body ?? { kind: 'none' },
    }),
    [method, url, headers, body]
  );

  const scheduleAutoSave = useCallback(
    (patch: Partial<HttpRequestV1>) => {
      const fullPatch = buildDraftPatch(patch);
      pendingPatchRef.current = fullPatch;
      if (patchTimerRef.current !== null) {
        window.clearTimeout(patchTimerRef.current);
      }
      patchTimerRef.current = window.setTimeout(() => {
        patchTimerRef.current = null;
        const pendingPatch = pendingPatchRef.current;
        pendingPatchRef.current = null;
        if (pendingPatch) onPatch(pendingPatch);
      }, AUTO_SAVE_DEBOUNCE_MS);
    },
    [buildDraftPatch, onPatch]
  );

  const buildDraftRequest = useCallback((): HttpRequestV1 => {
    return {
      ...request,
      method,
      url,
      headers,
      body: body ?? { kind: 'none' },
    };
  }, [request, method, url, headers, body]);

  const flushDraftBeforeSend = useCallback((): HttpRequestV1 | null => {
    const draft = buildDraftRequest();
    const content = draft.body?.kind !== 'none' ? draft.body?.content ?? '' : '';
    if (content.length > 0 && bodyExceedsCap(content)) {
      pushBodyTooLargeNotice();
      return null;
    }
    if (patchTimerRef.current !== null) {
      window.clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    onPatch({
      method: draft.method,
      url: draft.url,
      headers: draft.headers,
      body: draft.body,
    });
    return draft;
  }, [buildDraftRequest, bodyExceedsCap, onPatch, pushBodyTooLargeNotice]);

  const sendCurrentDraft = useCallback(() => {
    if (isExecuting) return;
    const draft = flushDraftBeforeSend();
    if (!draft) return;
    onSend(draft);
  }, [flushDraftBeforeSend, isExecuting, onSend]);

  useEffect(() => {
    return () => {
      if (patchTimerRef.current !== null) {
        window.clearTimeout(patchTimerRef.current);
        patchTimerRef.current = null;
        const pendingPatch = pendingPatchRef.current;
        pendingPatchRef.current = null;
        if (pendingPatch) onPatch(pendingPatch);
      }
    };
  }, [onPatch]);

  // Fold A — Cmd/Ctrl+Enter sends.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      sendCurrentDraft();
    },
    [sendCurrentDraft]
  );

  // Fold B — cURL paste import. Listens on the URL input only.
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
              setMethod(parsed.method);
              setUrl(parsed.url);
              if (parsed.headers.length > 0) setHeaders(parsed.headers);
              if (parsed.body) setBody(parsed.body);
              onPatch({
                method: parsed.method,
                url: parsed.url,
                ...(parsed.headers.length > 0 ? { headers: parsed.headers } : {}),
                ...(parsed.body ? { body: parsed.body } : {}),
              });
            },
          },
        ],
      });
    },
    [bodyExceedsCap, onPatch, pushBodyTooLargeNotice]
  );

  const handleAddHeader = useCallback(() => {
    const next: HttpRequestHeader[] = [
      ...headers,
      { name: '', value: '', enabled: true },
    ];
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

  const supportsBody = useMemo(
    () => method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS',
    [method]
  );

  const bodyKind: HttpRequestBodyKind = body?.kind ?? 'none';

  return (
    <div
      data-testid="http-request-editor"
      onKeyDown={handleKeyDown}
      className="flex h-full min-w-0 flex-col gap-2 overflow-hidden p-3"
    >
      {/* Method + URL row */}
      <div className="flex shrink-0 items-center gap-2">
        <label className="sr-only" htmlFor="http-request-method">
          {t('httpWorkspace.editor.method.label')}
        </label>
        <select
          id="http-request-method"
          data-testid="http-request-editor-method"
          value={method}
          onChange={(event) => {
            const next = event.target.value as HttpMethod;
            setMethod(next);
            scheduleAutoSave({ method: next });
          }}
          className="h-8 shrink-0 rounded-md border border-border/60 bg-surface/40 px-2 text-xs font-bold tabular-nums focus:border-border-strong focus:outline-none"
        >
          {HTTP_METHODS.map((m) => (
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
          onChange={(event) => {
            setUrl(event.target.value);
            scheduleAutoSave({ url: event.target.value });
          }}
          onPaste={handleUrlPaste}
          className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 text-xs focus:border-border-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={sendCurrentDraft}
          disabled={isExecuting || url.trim().length === 0}
          data-testid="http-request-editor-send"
          aria-label={t('httpWorkspace.editor.send.label')}
          title={`${t('httpWorkspace.editor.send.label')} · ${t('httpWorkspace.editor.send.shortcutHint')}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/60 bg-primary/10 text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isExecuting ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Send size={14} aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Headers + Body — keep both visible in a 2-row layout so the
          user does not need to switch tabs to inspect either. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <section data-testid="http-request-editor-headers">
          <header className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              {t('httpWorkspace.editor.headers.label')}
            </span>
            <button
              type="button"
              onClick={handleAddHeader}
              data-testid="http-request-editor-headers-add"
              aria-label={t('httpWorkspace.editor.headers.add')}
              title={t('httpWorkspace.editor.headers.add')}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <Plus size={12} aria-hidden="true" />
            </button>
            {headers.length === 0 ? (
              <span className="text-[11px] text-muted">
                {t('httpWorkspace.editor.headers.empty')}
              </span>
            ) : null}
          </header>
          <ul role="list" className="mt-1 flex flex-col gap-1">
            {headers.map((h, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={(event) =>
                    handleUpdateHeader(i, { enabled: event.target.checked })
                  }
                  data-testid="http-request-editor-header-enabled"
                  aria-label={t('httpWorkspace.editor.headers.enabledAria', {
                    name: h.name,
                  })}
                />
                <input
                  type="text"
                  value={h.name}
                  onChange={(event) =>
                    handleUpdateHeader(i, { name: event.target.value })
                  }
                  placeholder={t('httpWorkspace.editor.headers.name.placeholder')}
                  aria-label={t('httpWorkspace.editor.headers.name.placeholder')}
                  data-testid="http-request-editor-header-name"
                  className="h-7 w-36 rounded-md border border-border/40 bg-background px-2 text-[11px] focus:border-border-strong focus:outline-none"
                />
                <input
                  type="text"
                  value={h.value}
                  onChange={(event) =>
                    handleUpdateHeader(i, { value: event.target.value })
                  }
                  placeholder={t('httpWorkspace.editor.headers.value.placeholder')}
                  aria-label={t('httpWorkspace.editor.headers.value.placeholder')}
                  data-testid="http-request-editor-header-value"
                  className="h-7 min-w-0 flex-1 rounded-md border border-border/40 bg-background px-2 text-[11px] focus:border-border-strong focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveHeader(i)}
                  aria-label={t('httpWorkspace.editor.headers.remove.aria')}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:text-rose-500"
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {supportsBody ? (
          <section data-testid="http-request-editor-body">
            <header className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                {t('httpWorkspace.editor.body.label')}
              </span>
              <select
                value={bodyKind}
                onChange={(event) => {
                  const kind = event.target.value as HttpRequestBodyKind;
                  const next: HttpRequestBody = {
                    kind,
                    ...(kind !== 'none' ? { content: body?.content ?? '' } : {}),
                  };
                  setBody(next);
                  scheduleAutoSave({ body: next });
                }}
                data-testid="http-request-editor-body-kind"
                className="h-6 rounded-md border border-border/40 bg-surface/40 px-1.5 text-[10px] font-bold focus:border-border-strong focus:outline-none"
              >
                <option value="none">
                  {t('httpWorkspace.editor.body.kind.none')}
                </option>
                <option value="json">
                  {t('httpWorkspace.editor.body.kind.json')}
                </option>
                <option value="text">
                  {t('httpWorkspace.editor.body.kind.text')}
                </option>
                <option value="form">
                  {t('httpWorkspace.editor.body.kind.form')}
                </option>
              </select>
            </header>
            {bodyKind !== 'none' ? (
              <textarea
                value={body?.content ?? ''}
                onChange={(event) => {
                  if (bodyExceedsCap(event.target.value)) {
                    pushBodyTooLargeNotice();
                    return;
                  }
                  const next: HttpRequestBody = {
                    kind: bodyKind,
                    content: event.target.value,
                  };
                  setBody(next);
                  scheduleAutoSave({ body: next });
                }}
                placeholder={t('httpWorkspace.editor.body.placeholder')}
                aria-label={t('httpWorkspace.editor.body.label')}
                data-testid="http-request-editor-body-content"
                className="mt-1 h-24 w-full resize-y rounded-md border border-border/40 bg-background p-2 font-mono text-[11px] focus:border-border-strong focus:outline-none"
              />
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
