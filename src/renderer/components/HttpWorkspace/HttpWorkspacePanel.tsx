/**
 * RL-097 Slice 1 — Root component of the HTTP workspace editor tab.
 * Three-column layout (request list | editor | response).
 *
 * Wires the store actions, the runtime execution path, the capsule
 * builder, and the telemetry emit. Each sub-component stays
 * purely presentational; the orchestration lives here.
 */

import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { SendHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { getBundledAppInfo } from '../../../shared/appInfo';
import {
  applyCaptureRules,
  createBlankHttpRequest,
  type HttpRequestV1,
} from '../../../shared/httpWorkspace';
import {
  collectSecretResolvedValues,
  findResolvedVariables,
  findUnresolvedVariables,
  interpolateRequest,
  looksSecret,
  maskSecretsForCapsule,
  maskSecretValuesInResponse,
} from '../../../shared/httpEnvironment';
import { executeHttpRequest } from '../../runtime/httpClient';
import { buildHttpResponseCapsule } from '../../runtime/httpResponseCapsule';
import { useAnnounce } from '../../hooks/useAnnounce';
import { trackHttpRequestExecuted } from '../../hooks/httpWorkspaceTelemetry';
import { EmptyState } from '../ui/EmptyState';
import { HttpRequestList } from './HttpRequestList';
import { HttpRequestEditor } from './HttpRequestEditor';
import { HttpResponsePreview } from './HttpResponsePreview';
import { HttpResponseHistory } from './HttpResponseHistory';
import { HttpEnvironmentManager } from './HttpEnvironmentManager';

export interface HttpWorkspacePanelProps {
  /**
   * SQL/HTTP MODEL rework — the HTTP surface is a single COLLECTION
   * workspace tab, not one tab per request. `tabId` (the stable
   * workspace tab id) is accepted for the AppLayout / view mount but is
   * NOT a request binding: the editor + response columns bind to the
   * STORE's `activeRequestId`, driven entirely by the in-panel rail.
   * Retained only for call-site compatibility; the panel ignores it for
   * selection.
   */
  tabId?: string;
}

/**
 * T2 — apply a request's resolved capture writes to the ACTIVE
 * environment. Upserts by variable key (existing key → value updated;
 * new key → appended, secret-by-default via the `looksSecret`
 * heuristic). Surfaces a warning when there is no active environment to
 * receive the writes, and a success summary otherwise. Reads the store
 * live via `getState()` so a switch during the in-flight request never
 * writes to a stale environment.
 */
function applyCapturesToActiveEnvironment(
  writes: ReadonlyArray<{ targetVariable: string; value: string }>
): void {
  if (writes.length === 0) return;
  const store = useWorkspaceToolStore.getState();
  const envId = store.activeEnvironmentId;
  if (envId === null) {
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'httpWorkspace.capture.noEnvironment',
    });
    return;
  }
  store.updateEnvironmentVariables(envId, (variables) => {
    const next = variables.slice();
    for (const write of writes) {
      const idx = next.findIndex((v) => v.key === write.targetVariable);
      if (idx >= 0) {
        next[idx] = { ...next[idx]!, value: write.value };
      } else {
        next.push({
          id: crypto.randomUUID(),
          key: write.targetVariable,
          value: write.value,
          secret: looksSecret(write.targetVariable),
        });
      }
    }
    return next;
  });
  const envName = store.environments.find((e) => e.id === envId)?.name ?? '';
  useUIStore.getState().pushStatusNotice({
    tone: 'success',
    messageKey: 'httpWorkspace.capture.applied',
    values: { count: writes.length, env: envName },
  });
}

export function HttpWorkspacePanel(_props: HttpWorkspacePanelProps = {}) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  // Persisted layout per the resizable-panels convention used
  // throughout AppLayout. Storage key isolated to this surface so a
  // future SQL workspace (Slice 2) can have its own layout sibling.
  const layout = useDefaultLayout({
    id: 'lingua-http-workspace-layout',
    panelIds: [
      'http-request-list',
      'http-request-editor',
      'http-response-preview',
    ],
    storage: localStorage,
  });
  const requests = useWorkspaceToolStore((state) => state.requests);
  const activeRequestId = useWorkspaceToolStore((state) => state.activeRequestId);
  const executingRequestId = useWorkspaceToolStore(
    (state) => state.executingRequestId
  );
  // The active request's Send button is busy only while THAT request is
  // the one in flight (per-request execution tracking).
  const isExecuting =
    executingRequestId !== null && executingRequestId === activeRequestId;
  const responsesByRequestId = useWorkspaceToolStore(
    (state) => state.responsesByRequestId
  );
  const sensitiveHttpHeaders = useSettingsStore(
    (state) => state.sensitiveHttpHeaders
  );
  // RL-097 Slice 3a — environments + active selection drive the
  // selector, the resolution preview, and send-time interpolation.
  const environments = useWorkspaceToolStore((state) => state.environments);
  const activeEnvironmentId = useWorkspaceToolStore(
    (state) => state.activeEnvironmentId
  );
  const [isManagerOpen, setIsManagerOpen] = useState<boolean>(false);
  // AbortController for the in-flight send. Held in a ref (not state) so
  // Stop / supersede can reach it without re-rendering; the `finally`
  // compares identity to avoid a stale settle clearing a newer send.
  const abortRef = useRef<AbortController | null>(null);
  // Which response in the active request's history the preview shows.
  // 0 = newest (the default, which the live preview lands on). Reset to
  // newest whenever the active request changes or a new run records.
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  // The (request id + newest response) the index is anchored to. Stored
  // as state (not a ref) so the documented "adjust state during render"
  // reset pattern fires exactly once per change.
  const [historyAnchor, setHistoryAnchor] = useState<string>('');

  // SQL/HTTP MODEL rework — the rail is the single source of collection
  // navigation. On mount (and whenever the active id is cleared while
  // requests remain — e.g. after a delete that left no active), auto-
  // select the first request so the editor is never blank when the
  // collection is non-empty. Mirrors Insomnia reopening onto the top
  // request.
  useEffect(() => {
    const store = useWorkspaceToolStore.getState();
    if (store.activeRequestId !== null) return;
    const first = store.requests[0];
    if (first) store.setActiveRequest(first.id);
  }, [requests.length, activeRequestId]);

  // SQL/HTTP MODEL rework — the editor + response columns bind to the
  // store's `activeRequestId`, the single source of collection
  // navigation driven by the rail. The container tab owns the whole
  // collection, not one request, so there is no per-tab pin.
  const activeRequest: HttpRequestV1 | undefined = useMemo(
    () => requests.find((r) => r.id === activeRequestId),
    [requests, activeRequestId]
  );
  const activeHistory = useMemo(
    () => (activeRequest ? responsesByRequestId[activeRequest.id] ?? [] : []),
    [activeRequest, responsesByRequestId]
  );

  // Snap the selected history row back to the newest (index 0) when the
  // active request switches or a fresh run lands at the top. Adjusting
  // state during render (the documented alternative to a reset effect)
  // avoids the extra commit + the cascading-render lint.
  const newestRecordedAt = activeHistory[0]?.recordedAt;
  const nextHistoryAnchor = `${activeRequestId ?? ''}:${newestRecordedAt ?? ''}`;
  if (historyAnchor !== nextHistoryAnchor) {
    setHistoryAnchor(nextHistoryAnchor);
    if (historyIndex !== 0) setHistoryIndex(0);
  }

  // Clamp the selected index to the current history length, then resolve
  // the shown response. The store records newest-first, so index 0 is
  // the live response; selecting an older history row shows its
  // metadata (the LRU stripped the body off non-newest entries).
  const safeHistoryIndex =
    historyIndex < activeHistory.length ? historyIndex : 0;
  const activeResponse = activeHistory[safeHistoryIndex];

  // SQL/HTTP MODEL rework — a new request is a row in the collection,
  // NOT a new editor tab. `createRequest` appends it and selects it (the
  // store sets `activeRequestId` to the new id); the rail re-renders and
  // the editor binds to it. Default name stays empty (not localised) so a
  // language switch never shows a bilingual list; the list renderer falls
  // back to the localised placeholder for unnamed requests.
  const handleCreate = useCallback(() => {
    const req = createBlankHttpRequest({
      id: crypto.randomUUID(),
      name: '',
    });
    useWorkspaceToolStore.getState().createRequest(req);
  }, []);

  // SQL/HTTP MODEL rework — selecting a rail row moves the store's active
  // request. The rail is the single source of collection navigation;
  // every request (including the full set an importer drops in) is a
  // first-class, directly-selectable row — no per-request FileTab, no
  // promotion dance, no budget gate.
  const handleSelect = useCallback((id: string) => {
    useWorkspaceToolStore.getState().setActiveRequest(id);
  }, []);

  const handleRename = useCallback((id: string, name: string) => {
    useWorkspaceToolStore.getState().updateRequest(id, { name });
  }, []);

  // Duplicate a rail row — clone the request under a fresh id and a
  // "(copy)" suffix, then select the clone. The clone carries the full
  // builder state (method, URL, params, auth, headers, body) but NOT
  // the response history (a new request starts with a clean slate).
  const handleDuplicate = useCallback(
    (id: string) => {
      const store = useWorkspaceToolStore.getState();
      const source = store.getRequest(id);
      if (!source) return;
      const now = new Date().toISOString();
      const baseName =
        source.name.length > 0
          ? source.name
          : t('httpWorkspace.requestList.rename.placeholder');
      const clone: HttpRequestV1 = {
        ...source,
        id: crypto.randomUUID(),
        name: t('httpWorkspace.requestList.duplicate.name', { name: baseName }),
        createdAt: now,
        updatedAt: now,
      };
      store.createRequest(clone);
    },
    [t]
  );

  // SQL/HTTP MODEL rework — deleting a rail row removes the request from
  // the collection. `deleteRequest` drops it + its response history and
  // re-points `activeRequestId` to the next surviving request (or null).
  // The workspace tab is unaffected — closing the tab is a separate
  // gesture that leaves the collection intact.
  const handleDelete = useCallback((id: string) => {
    useWorkspaceToolStore.getState().deleteRequest(id);
  }, []);

  // RQ-02 — patch the request the editor names explicitly, never a
  // closed-over `activeRequest` that may have switched during the
  // editor's debounce quiet window. `updateRequest` no-ops on an
  // unknown id, so a flush for a just-deleted request is harmless.
  const handlePatch = useCallback(
    (requestId: string, patch: Partial<HttpRequestV1>) => {
      useWorkspaceToolStore.getState().updateRequest(requestId, patch);
    },
    []
  );

  // RL-097 Slice 3a — send pipeline with environment interpolation +
  // secret-aware redaction. The privacy invariant (no resolved secret on
  // any persisted / shared / displayed surface) is enforced here:
  //   - `interpolateRequest` resolves ALL vars into the OUTBOUND request
  //     (the only surface that carries a resolved secret — it goes
  //     straight to fetch and is never recorded).
  //   - `maskSecretValuesInResponse` scrubs any secret a server echoed
  //     back BEFORE the response is recorded / capsuled.
  //   - `maskSecretsForCapsule` keeps secret tokens as `{{key}}` in the
  //     capsule source so the export never carries the resolved value.
  const handleSend = useCallback(async (requestToSend: HttpRequestV1) => {
    // Block a duplicate send of the SAME request; a different request
    // may still start (per-request execution model). Abort any prior
    // in-flight send so only one request executes at a time.
    if (
      useWorkspaceToolStore.getState().executingRequestId === requestToSend.id
    ) {
      return;
    }
    abortRef.current?.abort('superseded');
    const controller = new AbortController();
    abortRef.current = controller;
    const env = useWorkspaceToolStore.getState().getActiveEnvironment() ?? null;

    // Block the send when a referenced `{{var}}` has no binding in the
    // active env (or there is no env). Surfacing the names lets the user
    // fix the environment without guessing which token is missing.
    const unresolved = findUnresolvedVariables(requestToSend, env);
    if (unresolved.length > 0) {
      useUIStore.getState().pushStatusNotice({
        tone: 'error',
        messageKey: 'httpWorkspace.environment.unresolved.body',
        values: {
          count: unresolved.length,
          names: unresolved.join(', '),
        },
      });
      return;
    }

    useWorkspaceToolStore.getState().setExecutingRequestId(requestToSend.id);
    try {
      // Resolve EVERY var (secret + non-secret) into the outbound request.
      const outbound = interpolateRequest(requestToSend, env);
      const raw = await executeHttpRequest(outbound, {
        userSensitiveHeaders: sensitiveHttpHeaders,
        signal: controller.signal,
      });
      // User cancelled (Stop) or a newer send superseded this one: leave
      // the previous response visible and skip recording entirely.
      if (controller.signal.aborted) {
        return;
      }
      // Scrub any echoed secret value out of the response BEFORE it is
      // recorded or capsuled. No-op when there are no secrets.
      const response = maskSecretValuesInResponse(
        raw,
        collectSecretResolvedValues(env)
      );
      useWorkspaceToolStore
        .getState()
        .recordResponse(requestToSend.id, response);
      // T2 — request chaining. On a successful response, apply the
      // request's capture rules: extract values from the RAW response
      // (real values, before secret-masking) and upsert them into the
      // ACTIVE environment so the next request can interpolate them via
      // `{{VAR}}`. A brand-new captured token is not yet a known secret,
      // so extracting from `raw` (not the masked `response`) is what
      // yields the real value to store.
      if (response.kind === 'success' && requestToSend.captures?.length) {
        applyCapturesToActiveEnvironment(
          applyCaptureRules(raw, requestToSend.captures)
        );
      }
      const resolvedCount = findResolvedVariables(requestToSend, env).length;
      trackHttpRequestExecuted(requestToSend.method, response, resolvedCount);
      // UX Sweep T4 — announce the response to screen readers; the status
      // pill + response panes only convey it visually. HTTP 4xx/5xx are
      // still real responses, so announce their status instead of flattening
      // them into a generic failure. Some servers omit statusText, so fall
      // back to a status-only phrasing to avoid a dangling "Response 200 .".
      if (response.status > 0) {
        announce(
          response.statusText.trim()
            ? t('httpWorkspace.run.announce', {
                status: response.status,
                statusText: response.statusText,
              })
            : t('httpWorkspace.run.announceStatus', { status: response.status })
        );
      } else {
        announce(t('httpWorkspace.run.announceError'));
      }
      let capsule;
      try {
        const appInfo = getBundledAppInfo();
        const platform: 'web' | 'desktop' =
          typeof window !== 'undefined' && window.lingua?.platform === 'desktop'
            ? 'desktop'
            : 'web';
        // Capsule-safe request: non-secret vars resolved (replay
        // fidelity), secret vars kept as `{{key}}` placeholders.
        const capsuleSafe = maskSecretsForCapsule(requestToSend, env);
        capsule = await buildHttpResponseCapsule({
          appVersion: appInfo.version,
          requestName: requestToSend.name,
          request: capsuleSafe,
          response,
          platform,
          userSensitiveHeaders: sensitiveHttpHeaders,
        });
      } catch {
        capsule = undefined;
      }
      useExecutionHistoryStore.getState().record({
        language: 'http',
        status: response.kind === 'success' ? 'ok' : 'error',
        durationMs: response.durationMs,
        ...(capsule !== undefined ? { lastCapsule: capsule } : {}),
      });
    } catch (err) {
      // `executeHttpRequest` always settles; this catch is defensive.
      useUIStore.getState().pushStatusNotice({
        tone: 'error',
        messageKey: 'httpWorkspace.response.error.network',
        detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
      });
    } finally {
      // Only clear execution state if THIS send is still the current one
      // (a superseding send installed its own controller + id already).
      if (abortRef.current === controller) {
        abortRef.current = null;
        useWorkspaceToolStore.getState().setExecutingRequestId(null);
      }
    }
  }, [sensitiveHttpHeaders, t, announce]);

  // Cancel the in-flight request (Stop button). Leaves the previous
  // response on screen; the aborted send skips recording.
  const handleStop = useCallback(() => {
    abortRef.current?.abort('cancelled');
  }, []);

  const handleSelectEnvironment = useCallback((id: string | null) => {
    useWorkspaceToolStore.getState().setActiveEnvironment(id);
  }, []);

  const handleManageEnvironment = useCallback(() => {
    setIsManagerOpen(true);
  }, []);

  return (
    <div
      data-testid="http-workspace-panel"
      className="flex h-full min-w-0 flex-col"
    >
      <Group
        orientation="vertical"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
        resizeTargetMinimumSize={{ coarse: 24, fine: 24 }}
        className="h-full"
      >
        <Panel id="http-request-list" defaultSize="20%" minSize={180}>
          <HttpRequestList
            requests={requests}
            activeRequestId={activeRequestId}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onRename={handleRename}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
          />
        </Panel>
        <Panel id="http-request-editor" defaultSize="50%" minSize={320}>
          {activeRequest ? (
            <HttpRequestEditor
              request={activeRequest}
              onPatch={handlePatch}
              onSend={handleSend}
              onStop={handleStop}
              isExecuting={isExecuting}
              environments={environments}
              activeEnvironmentId={activeEnvironmentId}
              onSelectEnvironment={handleSelectEnvironment}
              onManageEnvironment={handleManageEnvironment}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-4 py-6">
              <EmptyState
                icon={<SendHorizontal size={18} aria-hidden="true" />}
                title={t('httpWorkspace.empty.title')}
                description={t('httpWorkspace.empty.body')}
              />
            </div>
          )}
        </Panel>
        <Panel id="http-response-preview" defaultSize="30%" minSize={220}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">
              <HttpResponsePreview
                response={activeResponse}
                isExecuting={isExecuting}
              />
            </div>
            <HttpResponseHistory
              history={activeHistory}
              selectedIndex={safeHistoryIndex}
              onSelect={setHistoryIndex}
            />
          </div>
        </Panel>
      </Group>
      {isManagerOpen ? (
        <HttpEnvironmentManager
          environments={environments}
          onClose={() => setIsManagerOpen(false)}
          onCreate={(env) =>
            useWorkspaceToolStore.getState().createEnvironment(env)
          }
          onUpdate={(id, patch) =>
            useWorkspaceToolStore.getState().updateEnvironment(id, patch)
          }
          onUpdateVariables={(id, updater) =>
            useWorkspaceToolStore
              .getState()
              .updateEnvironmentVariables(id, updater)
          }
          onDelete={(id) =>
            useWorkspaceToolStore.getState().deleteEnvironment(id)
          }
          onDuplicate={(id) =>
            useWorkspaceToolStore
              .getState()
              .duplicateEnvironment(
                id,
                crypto.randomUUID(),
                t('httpWorkspace.environment.manager.copySuffix')
              )
          }
          onExport={(id) =>
            useWorkspaceToolStore.getState().exportEnvironmentJson(id)
          }
          onImport={(json) =>
            useWorkspaceToolStore.getState().importEnvironmentJson(json)
          }
        />
      ) : null}
    </div>
  );
}
