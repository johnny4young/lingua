/**
 * Root component of the HTTP workspace editor tab.
 * Request list beside the editor; the response sits under the editor, or in a
 * third column once the workspace is wide enough to give it 560 px.
 *
 * Wires the store actions, the runtime execution path, the capsule
 * builder, and the telemetry emit. Each sub-component stays
 * purely presentational; the orchestration lives here.
 */

import { Group, Panel, useDefaultLayout, type GroupImperativeHandle } from 'react-resizable-panels';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWidthTier } from '../../hooks/useWidthTier';
import { ResizeHandle } from '../ui/ResizeHandle';
import { cn } from '../../utils/cn';
import { secretCaptureValues } from '../../../shared/httpPersistedSecrets';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import { HttpStarterRequests } from './HttpStarterRequests';
import { isPristineRequest, type StarterPatch } from './httpStarters';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { getBundledAppInfo } from '../../../shared/appInfo';
import { applyCaptureRules } from '../../../shared/httpWorkspaceCaptures';
import type {
  HttpPipelineRunSnapshot,
  HttpPipelineStepResult,
  HttpPipelineV1,
} from '../../../shared/httpPipeline';
import {
  createBlankHttpRequest,
  type HttpRequestV1,
  type HttpResponseV1,
} from '../../../shared/httpWorkspaceSchema';
import {
  collectSecretResolvedValues,
  findResolvedVariables,
  findUnresolvedVariables,
  interpolateRequest,
  looksSecret,
  looksSecretValue,
  collectSecretKeys,
  maskSecretsForCapsule,
  maskSecretValuesInResponse,
  environmentColor,
} from '../../../shared/httpEnvironment';
import { executeHttpRequest } from '../../runtime/httpClient';
import { buildHttpResponseCapsule } from '../../runtime/httpResponseCapsule';
import { useAnnounce } from '../../hooks/useAnnounce';
import { trackHttpRequestExecuted } from '../../hooks/httpWorkspaceTelemetry';
import { HttpEmptyState } from './HttpEmptyState';
import { HttpRequestList } from './HttpRequestList';
import { HttpRequestEditor } from './HttpRequestEditor';
import { HttpResponsePreview } from './HttpResponsePreview';
import type { JsonSegment } from './httpJsonTreeModel';
import type { HttpCaptureTarget } from './useHttpTreeCapture';
import { useHttpOfflineSend } from './useHttpOfflineSend';
import { snapshotChanges } from '../../../shared/httpSnapshot';
import {
  rowsFromOtherEnvironments,
  scopedEnvironmentFor,
  type HttpEnvironmentFocus,
  type HttpSendOptions,
} from './httpScopes';
import { chainedOrigin, chainOrder, chainPasses, chainTags, latestFor, requestLabel, sourceNeedsSend } from '../../../shared/httpChain';
import { HttpResponseHistory } from './HttpResponseHistory';
import { HttpEnvironmentManager } from './HttpEnvironmentManager';
import { HttpEnvironmentSelector } from './HttpEnvironmentSelector';
import { ENVIRONMENT_TINTS } from './httpScopeColors';
import { CommandBarSlot } from '../Chrome/CommandBarSlot';
import { HttpPipelineManager } from './HttpPipelineManager';
import { readPipelineStep } from './httpPipelineReport';
import { appPlatform } from '../../utils/appPlatform';
import { recordTabLastAnswer } from '../../stores/tabLastAnswer';
import { HTTP_WORKSPACE_TAB_ID } from '../../stores/editorTabUtils';

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
 * Apply a request's resolved capture writes to the ACTIVE
 * environment. Upserts by variable key (existing key → value updated;
 * new key → appended, secret-by-default via the `looksSecret`
 * heuristic). Surfaces a warning when there is no active environment to
 * receive the writes, and a success summary otherwise. Reads the store
 * live via `getState()` so a switch during the in-flight request never
 * writes to a stale environment.
 */
function applyCapturesToActiveEnvironment(
  writes: ReadonlyArray<{ targetVariable: string; value: string }>,
  // A chain reads its tags from the response, so its sources need neither notice.
  quiet = false
): void {
  if (writes.length === 0) return;
  const store = useWorkspaceToolStore.getState();
  const envId = store.activeEnvironmentId;
  if (envId === null) {
    if (quiet) return;
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'httpWorkspace.capture.noEnvironment',
    });
    return;
  }
  store.updateEnvironmentVariables(envId, variables => {
    const next = variables.slice();
    for (const write of writes) {
      const idx = next.findIndex(v => v.key === write.targetVariable);
      if (idx >= 0) {
        next[idx] = { ...next[idx]!, value: write.value };
      } else {
        next.push({
          id: crypto.randomUUID(),
          key: write.targetVariable,
          value: write.value,
          secret: looksSecret(write.targetVariable) || looksSecretValue(write.value),
        });
      }
    }
    return next;
  });
  if (quiet) return;
  const envName = store.environments.find(e => e.id === envId)?.name ?? '';
  useUIStore.getState().pushStatusNotice({
    tone: 'success',
    messageKey: 'httpWorkspace.capture.applied',
    values: { count: writes.length, env: envName },
  });
}

/** From this width a 560 px response column still leaves the editor room for test answers; narrower, it sits under the editor. */
const COLUMNS_MIN_WIDTH = [1760] as const;
const RESIZE_TARGET = { coarse: 24, fine: 24 };
const SIDEBAR_PANELS = ['http-request-list', 'http-request-main'];
const MAIN_PANELS = ['http-request-editor', 'http-response-preview'];
const SPLITS = {
  columns: { layoutId: 'lingua-http-workspace-columns-layout', axis: 'horizontal', handle: 'vertical', editorMin: 320, responseMin: 560, border: 'border-l', layout: { 'http-request-editor': 56, 'http-response-preview': 44 } },
  stacked: { layoutId: 'lingua-http-workspace-stacked-layout', axis: 'vertical', handle: 'horizontal', editorMin: 160, responseMin: 180, border: 'border-t', layout: { 'http-request-editor': 42, 'http-response-preview': 58 } },
} as const;

export function HttpWorkspacePanel(_props: HttpWorkspacePanelProps = {}) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const rootRef = useRef<HTMLDivElement>(null);
  const split = useWidthTier(rootRef, COLUMNS_MIN_WIDTH, 1) === 1 ? SPLITS.columns : SPLITS.stacked;
  const columns = split === SPLITS.columns;
  const sidebarLayout = useDefaultLayout({ id: 'lingua-http-workspace-sidebar-layout', panelIds: SIDEBAR_PANELS, storage: localStorage });
  // Sizes persist per arrangement: they split the main pane along different axes.
  // Only drags are saved, so the unmeasured first pass never clamps the other arrangement's sizes.
  const mainLayout = useDefaultLayout({ id: split.layoutId, panelIds: MAIN_PANELS, storage: localStorage, onlySaveAfterUserInteractions: true });
  const mainGroupRef = useRef<GroupImperativeHandle | null>(null);
  const previousSplitRef = useRef(split);
  useLayoutEffect(() => {
    // The Group keeps its last layout across an orientation flip; restore this arrangement's own.
    if (previousSplitRef.current === split) return;
    previousSplitRef.current = split;
    mainGroupRef.current?.setLayout(mainLayout.defaultLayout ?? split.layout);
  }, [split, mainLayout.defaultLayout]);
  const requests = useWorkspaceToolStore(state => state.requests);
  const pipelineCount = useWorkspaceToolStore(state => state.httpPipelines.length);
  const activeRequestId = useWorkspaceToolStore(state => state.activeRequestId);
  const executingRequestId = useWorkspaceToolStore(state => state.executingRequestId);
  // The active request's Send button is busy only while THAT request is
  // the one in flight (per-request execution tracking).
  // While a chain sends its sources, its request counts as running, so Send turns into Stop.
  const [chainRunningFor, setChainRunningFor] = useState<string | null>(null);
  const isExecuting =
    activeRequestId !== null && (executingRequestId === activeRequestId || chainRunningFor === activeRequestId);
  const responsesByRequestId = useWorkspaceToolStore(state => state.responsesByRequestId);
  const sensitiveHttpHeaders = useSettingsStore(state => state.sensitiveHttpHeaders);
  const httpAllowPrivateHosts = useSettingsStore(state => state.httpAllowPrivateHosts);
  const collectionVariables = useWorkspaceToolStore(state => state.collectionVariables);
  // Environments + active selection drive the
  // selector, the resolution preview, and send-time interpolation.
  const environments = useWorkspaceToolStore(state => state.environments);
  const activeEnvironmentId = useWorkspaceToolStore(state => state.activeEnvironmentId);
  const environmentColorName = environmentColor(environments.find(env => env.id === activeEnvironmentId));
  const environmentTint = environmentColorName ? ENVIRONMENT_TINTS[environmentColorName] : undefined;
  const [isManagerOpen, setIsManagerOpen] = useState<boolean>(false);
  const [managerFocus, setManagerFocus] = useState<HttpEnvironmentFocus | null>(null);
  const [isPipelineManagerOpen, setIsPipelineManagerOpen] = useState(false);
  const [pipelineRun, setPipelineRun] = useState<HttpPipelineRunSnapshot | null>(null);
  const pipelineRunningRef = useRef(false);
  const pipelineCancelledRef = useRef(false);
  // AbortController for the in-flight send. Held in a ref (not state) so
  // Stop / supersede can reach it without re-rendering; the `finally`
  // compares identity to avoid a stale settle clearing a newer send.
  const abortRef = useRef<AbortController | null>(null);
  // Which response in the active request's history the preview shows.
  // 0 = newest (the default, which the live preview lands on). Reset to
  // newest whenever the active request changes or a new run records.
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const captureTargetRef = useRef<HttpCaptureTarget | null>(null);
  // The (request id + newest response) the index is anchored to. Stored
  // as state (not a ref) so the documented "adjust state during render"
  // reset pattern fires exactly once per change.
  const [historyAnchor, setHistoryAnchor] = useState<string>('');
  const [livePreview, setLivePreview] = useState<{
    requestId: string;
    response: HttpResponseV1;
  } | null>(null);

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
    () => requests.find(r => r.id === activeRequestId),
    [requests, activeRequestId]
  );
  const activeHistory = useMemo(
    () => (activeRequest ? (responsesByRequestId[activeRequest.id] ?? []) : []),
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
  const safeHistoryIndex = historyIndex < activeHistory.length ? historyIndex : 0;
  const activeResponse =
    livePreview?.requestId === activeRequestId && isExecuting
      ? livePreview.response
      : activeHistory[safeHistoryIndex];
  // Older history rows have no body left to compare or keep.
  const snapshotsShown = safeHistoryIndex === 0;
  const storedSnapshot = activeRequest?.snapshot;
  // Undefined when there is no snapshot to compare the shown response with.
  const changes = useMemo(
    () => (snapshotsShown && storedSnapshot && activeResponse ? snapshotChanges(storedSnapshot, activeResponse) : undefined),
    [snapshotsShown, storedSnapshot, activeResponse]
  );

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
        source.name.length > 0 ? source.name : t('httpWorkspace.requestList.rename.placeholder');
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

  // Patch the request the editor names explicitly, never a
  // closed-over `activeRequest` that may have switched during the
  // editor's debounce quiet window. `updateRequest` no-ops on an
  // unknown id, so a flush for a just-deleted request is harmless.
  const handlePatch = useCallback((requestId: string, patch: Partial<HttpRequestV1>) => {
    useWorkspaceToolStore.getState().updateRequest(requestId, patch);
  }, []);
  // The editor keeps a draft of the request, so a starter remounts it from the patched request.
  const [editorGeneration, setEditorGeneration] = useState(0);
  const applyStarter = (request: HttpRequestV1, patch: StarterPatch) => {
    handlePatch(request.id, patch);
    setEditorGeneration(generation => generation + 1);
    // The old editor flushes its pending draft as it unmounts; the starter goes in again after that.
    window.setTimeout(() => handlePatch(request.id, patch), 0);
  };

  // Sends the sources a request's chain tags need first, in dependency order,
  // and stops on a cycle or on any response outside 2xx.
  const chainLockRef = useRef(false);
  const chainCancelledRef = useRef(false);
  const confirmRef = useRef<((send: boolean) => void) | null>(null);
  // Pauses a send whose scheme or host comes from a value the chain just captured, until the user confirms the host.
  const confirmOrigin = useCallback((request: HttpRequestV1, fresh: ReadonlySet<string>): Promise<boolean> => {
    const env = scopedEnvironmentFor(request, useWorkspaceToolStore.getState().getActiveEnvironment() ?? null);
    const origin = chainedOrigin(request.url, env, fresh);
    if (origin === null) return Promise.resolve(true);
    return new Promise(resolve => {
      let settled = false;
      const settle = (send: boolean) => {
        if (settled) return;
        settled = true;
        confirmRef.current = null;
        resolve(send);
      };
      confirmRef.current = settle;
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'httpWorkspace.chain.confirm',
        values: { name: requestLabel(request), origin },
        sticky: true,
        actions: [{ labelKey: 'httpWorkspace.chain.confirmSend', onClick: () => settle(true) }],
        // The CTA dismisses the notice before its click runs; every other close cancels.
        onDismiss: mode => {
          if (mode !== 'cta') settle(false);
        },
      });
    });
  }, []);
  const handleSendRef = useRef<((request: HttpRequestV1, options?: HttpSendOptions) => Promise<HttpResponseV1 | null>) | null>(null);
  const sendChain = useCallback(
    async (target: HttpRequestV1, force: boolean): Promise<ReadonlySet<string> | null> => {
      const requests = useWorkspaceToolStore.getState().requests.map(request => (request.id === target.id ? target : request));
      const byId = new Map(requests.map(request => [request.id, request]));
      const stop = (messageKey: string, values: Record<string, string>, tone: 'error' | 'info' = 'error') => {
        useUIStore.getState().pushStatusNotice({ tone, messageKey, values });
        return null;
      };
      // Variables the sources sent so far just captured.
      const fresh = new Set<string>();
      const { order, cycle, tooLong } = chainOrder(target.id, requests);
      if (cycle) return stop('httpWorkspace.chain.cycle', { name: requestLabel(target) });
      if (tooLong) return stop('httpWorkspace.chain.tooLong', { name: requestLabel(target) });
      const environmentId = useWorkspaceToolStore.getState().activeEnvironmentId;
      const latest = (id: string) => latestFor(useWorkspaceToolStore.getState().responsesByRequestId, id, environmentId);
      const needed = new Set<string>();
      const mark = (request: HttpRequestV1): void => {
        for (const tag of chainTags(request, requests)) {
          if (needed.has(tag.sourceId) || !(force || sourceNeedsSend(tag, latest(tag.sourceId), Date.now()))) continue;
          needed.add(tag.sourceId);
          const source = byId.get(tag.sourceId);
          if (source) mark(source);
        }
      };
      mark(target);
      for (const id of order) {
        const source = byId.get(id);
        if (!needed.has(id) || !source) continue;
        if ((source.transport ?? 'http') !== 'http') return stop('httpWorkspace.chain.liveSource', { name: requestLabel(source) });
        if (!(await confirmOrigin(source, fresh))) return stop('httpWorkspace.chain.stopped', { name: requestLabel(source), status: t('httpWorkspace.chain.cancelled') }, 'info');
        const response = await handleSendRef.current?.(source, { skipChain: true });
        // No response, or Stop while it was being recorded, means the user stopped the chain.
        if (!response || chainCancelledRef.current) return stop('httpWorkspace.chain.stopped', { name: requestLabel(source), status: t('httpWorkspace.chain.cancelled') }, 'info');
        const status = String(response.status || response.kind);
        if (!chainPasses(response)) return stop('httpWorkspace.chain.stopped', { name: requestLabel(source), status });
        for (const capture of source.captures ?? []) if (capture.enabled && capture.targetVariable.trim()) fresh.add(capture.targetVariable.trim());
      }
      return fresh;
    },
    [t, confirmOrigin]
  );

  // Send pipeline with environment interpolation +
  // secret-aware redaction. The privacy invariant (no resolved secret on
  // any persisted / shared / displayed surface) is enforced here:
  //   - `interpolateRequest` resolves ALL vars into the OUTBOUND request
  //     (the only surface that carries a resolved secret — it goes
  //     straight to fetch and is never recorded).
  //   - `maskSecretValuesInResponse` scrubs any secret a server echoed
  //     back BEFORE the response is recorded / capsuled.
  //   - `maskSecretsForCapsule` keeps secret tokens as `{{key}}` in the
  //     capsule source so the export never carries the resolved value.
  const handleSend = useCallback(
    async (requestToSend: HttpRequestV1, options?: HttpSendOptions): Promise<HttpResponseV1 | null> => {
      // Block a duplicate send of the SAME request; a different request
      // may still start (per-request execution model). Abort any prior
      // in-flight send so only one request executes at a time.
      if (useWorkspaceToolStore.getState().executingRequestId === requestToSend.id) {
        return null;
      }
      if (!options?.skipChain) {
        // One chain at a time: a second click while sources go out is ignored.
        if (chainLockRef.current) return null;
        chainLockRef.current = true;
        chainCancelledRef.current = false;
        setChainRunningFor(requestToSend.id);
        try {
          const fresh = await sendChain(requestToSend, options?.forceChain === true);
          if (!fresh) return null;
          if (!(await confirmOrigin(requestToSend, fresh))) {
            useUIStore.getState().pushStatusNotice({
              tone: 'info',
              messageKey: 'httpWorkspace.chain.stopped',
              values: { name: requestLabel(requestToSend), status: t('httpWorkspace.chain.cancelled') },
            });
            return null;
          }
        } finally {
          chainLockRef.current = false;
          setChainRunningFor(null);
        }
        // Something else may have started this request while its sources went out.
        if (useWorkspaceToolStore.getState().executingRequestId === requestToSend.id) return null;
      }
      abortRef.current?.abort('superseded');
      const controller = new AbortController();
      abortRef.current = controller;
      setLivePreview(null);
      const tools = useWorkspaceToolStore.getState();
      const activeEnv = tools.getActiveEnvironment() ?? null;
      const env = scopedEnvironmentFor(requestToSend, activeEnv);

      // Block the send when a referenced `{{var}}` has no binding in any
      // scope it resolves from. Surfacing the names lets the user fix the
      // environment without guessing which token is missing.
      const unresolved = findUnresolvedVariables(requestToSend, env);
      if (unresolved.length > 0) {
        const fix = activeEnv ? rowsFromOtherEnvironments(unresolved, tools.environments, activeEnv.id) : [];
        useUIStore.getState().pushStatusNotice({
          tone: 'error',
          messageKey: 'httpWorkspace.environment.unresolved.body',
          values: {
            count: unresolved.length,
            names: unresolved.join(', '),
          },
          ...(activeEnv && fix.length > 0
            ? {
                actions: [
                  {
                    labelKey: 'httpWorkspace.environment.unresolved.addTo',
                    labelValues: { env: activeEnv.name || t('httpWorkspace.environment.unnamed') },
                    onClick: () => {
                      tools.updateEnvironmentVariables(activeEnv.id, (variables) => [...variables, ...fix]);
                      const secret = fix.find((row) => row.secret);
                      if (secret) {
                        setManagerFocus({ environmentId: activeEnv.id, variableId: secret.id });
                        setIsManagerOpen(true);
                      }
                    },
                  },
                ],
              }
            : {}),
        });
        return null;
      }

      useWorkspaceToolStore.getState().setExecutingRequestId(requestToSend.id);
      try {
        // Resolve EVERY var (secret + non-secret) into the outbound request.
        const outbound = interpolateRequest(requestToSend, env);
        const secretValues = collectSecretResolvedValues(env);
        const raw = await executeHttpRequest(outbound, {
          userSensitiveHeaders: sensitiveHttpHeaders,
          allowPrivateHosts: httpAllowPrivateHosts,
          signal: controller.signal,
          runId: crypto.randomUUID(),
          onProgress: progress => {
            const preview: HttpResponseV1 = {
              version: 1,
              transport: requestToSend.transport === 'websocket' ? 'websocket' : 'sse',
              kind: 'success',
              status: progress.opened ? (requestToSend.transport === 'websocket' ? 101 : 200) : 0,
              statusText: progress.opened
                ? requestToSend.transport === 'websocket'
                  ? 'Switching Protocols'
                  : 'Streaming'
                : '',
              url: requestToSend.url,
              finalUrl: requestToSend.url,
              headers: [],
              body: progress.body,
              contentType:
                requestToSend.transport === 'websocket'
                  ? 'application/websocket'
                  : 'text/event-stream',
              sizeBytes: progress.sizeBytes,
              durationMs: 0,
              tooLarge: false,
              redactedHeaders: [],
              recordedAt: new Date().toISOString(),
              messageCount: progress.messageCount,
            };
            setLivePreview({
              requestId: requestToSend.id,
              response: maskSecretValuesInResponse(preview, secretValues),
            });
          },
        });
        // User cancelled (Stop) or a newer send superseded this one: leave
        // the previous response visible and skip recording entirely.
        if (controller.signal.aborted) {
          return null;
        }
        // Scrub any echoed secret value out of the response BEFORE it is
        // recorded or capsuled. No-op when there are no secrets.
        const masked = maskSecretValuesInResponse(raw, secretValues);
        const response = activeEnv ? { ...masked, environmentId: activeEnv.id } : masked;
        setLivePreview(null);
        useWorkspaceToolStore.getState().recordResponse(requestToSend.id, response);
        // Request chaining. On a successful response, apply the
        // request's capture rules: extract values from the RAW response
        // (real values, before secret-masking) and upsert them into the
        // ACTIVE environment so the next request can interpolate them via
        // `{{VAR}}`. A brand-new captured token is not yet a known secret,
        // so extracting from `raw` (not the masked `response`) is what
        // yields the real value to store.
        if (response.kind === 'success' && requestToSend.captures?.length) {
          applyCapturesToActiveEnvironment(applyCaptureRules(raw, requestToSend.captures), options?.skipChain === true);
        }
        const resolvedCount = findResolvedVariables(requestToSend, env).length;
        trackHttpRequestExecuted(requestToSend.method, response, resolvedCount);
        // accessibility pass — announce the response to screen readers; the status
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
        // A token this response introduced was not a known secret when it was masked.
        const answered = maskSecretValuesInResponse(response, secretCaptureValues(raw, requestToSend.captures ?? [], collectSecretKeys(env)));
        let capsule;
        try {
          const appInfo = getBundledAppInfo();
          const platform = appPlatform();
          // Capsule-safe request: non-secret vars resolved (replay
          // fidelity), secret vars kept as `{{key}}` placeholders.
          const capsuleSafe = maskSecretsForCapsule(requestToSend, env);
          capsule = await buildHttpResponseCapsule({
            appVersion: appInfo.version,
            requestName: requestToSend.name,
            request: capsuleSafe,
            response: answered,
            platform,
            userSensitiveHeaders: sensitiveHttpHeaders,
          });
        } catch {
          capsule = undefined;
        }
        void recordTabLastAnswer(HTTP_WORKSPACE_TAB_ID, ({ httpLastAnswer }, ranAt) => httpLastAnswer(answered, requestToSend.method, ranAt));
        useExecutionHistoryStore.getState().record({
          language: 'http',
          status: response.kind === 'success' ? 'ok' : 'error',
          durationMs: response.durationMs,
          ...(capsule !== undefined ? { lastCapsule: capsule } : {}),
          ...(response.kind === 'success'
            ? { summary: { kind: 'http' as const, method: requestToSend.method, status: response.status, statusText: response.statusText, bytes: response.sizeBytes } }
            : {}),
        });
        return response;
      } catch (err) {
        // `executeHttpRequest` always settles; this catch is defensive.
        useUIStore.getState().pushStatusNotice({
          tone: 'error',
          messageKey: 'httpWorkspace.response.error.network',
          detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
        });
        return null;
      } finally {
        // Only clear execution state if THIS send is still the current one
        // (a superseding send installed its own controller + id already).
        if (abortRef.current === controller) {
          abortRef.current = null;
          useWorkspaceToolStore.getState().setExecutingRequestId(null);
        }
      }
    },
    [sensitiveHttpHeaders, httpAllowPrivateHosts, t, announce, sendChain, confirmOrigin]
  );
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  const { sendFromEditor, queueFor, stopDrain } = useHttpOfflineSend(handleSend);

  // Cancel the in-flight request (Stop button). Leaves the previous
  // response on screen; the aborted send skips recording.
  const handleStop = useCallback(() => {
    pipelineCancelledRef.current = true;
    chainCancelledRef.current = true;
    if (confirmRef.current) useUIStore.getState().dismissStatusNotice('manual');
    abortRef.current?.abort('cancelled');
    stopDrain();
    setLivePreview(null);
  }, [stopDrain]);

  const handleRunPipeline = useCallback(
    async (pipeline: HttpPipelineV1): Promise<void> => {
      // React state does not update synchronously, so the rendered phase alone
      // cannot reject two clicks in the same event turn. Keep an imperative
      // lock for the runner and release it from every terminal publication.
      if (pipelineRunningRef.current) return;
      pipelineRunningRef.current = true;
      pipelineCancelledRef.current = false;
      const startedAt = new Date().toISOString();
      const enabledSteps = pipeline.steps.filter(step => step.enabled);
      const results: HttpPipelineStepResult[] = [];
      const publish = (phase: HttpPipelineRunSnapshot['phase'], activeStepId?: string): void => {
        setPipelineRun({
          pipelineId: pipeline.id,
          startedAt,
          ...(phase !== 'running' ? { finishedAt: new Date().toISOString() } : {}),
          phase,
          ...(activeStepId ? { activeStepId } : {}),
          results: [...results],
        });
      };
      try {
        publish('running', enabledSteps[0]?.id);
        for (const [index, step] of enabledSteps.entries()) {
          if (pipelineCancelledRef.current) {
            for (const remaining of enabledSteps.slice(index)) {
              results.push({
                stepId: remaining.id,
                requestId: remaining.requestId,
                status: 'skipped',
                message: 'cancelled',
              });
            }
            publish('cancelled');
            return;
          }
          publish('running', step.id);
          const request = useWorkspaceToolStore.getState().getRequest(step.requestId);
          if (!request || (request.transport ?? 'http') !== 'http') {
            results.push({
              stepId: step.id,
              requestId: step.requestId,
              status: 'failed',
              message: request ? 'live-transport' : 'missing-request',
            });
          } else {
            // Explicit pipelines keep their own order, so their steps never run tag chains.
            const response = await handleSend(request, { skipChain: true });
            if (!response) {
              if (pipelineCancelledRef.current) {
                results.push({
                  stepId: step.id,
                  requestId: step.requestId,
                  status: 'skipped',
                  message: 'cancelled',
                });
                for (const remaining of enabledSteps.slice(index + 1)) {
                  results.push({
                    stepId: remaining.id,
                    requestId: remaining.requestId,
                    status: 'skipped',
                    message: 'cancelled',
                  });
                }
                publish('cancelled');
                return;
              }
              results.push({
                stepId: step.id,
                requestId: step.requestId,
                status: 'failed',
                message: 'no-response',
              });
            } else {
              // A pending snapshot diff fails the step like a failed assertion.
              const env = scopedEnvironmentFor(request, useWorkspaceToolStore.getState().getActiveEnvironment() ?? null);
              const { passed, assertionFailures, report } = readPipelineStep(request, response, collectSecretKeys(env));
              results.push({
                stepId: step.id,
                requestId: step.requestId,
                status: passed ? 'passed' : 'failed',
                responseKind: response.kind,
                httpStatus: response.status,
                assertionFailures,
                report,
              });
            }
          }
          const failed = results.at(-1)?.status === 'failed';
          if (failed && pipeline.stopOnFailure) {
            for (const remaining of enabledSteps.slice(index + 1)) {
              results.push({
                stepId: remaining.id,
                requestId: remaining.requestId,
                status: 'skipped',
                message: 'stopped-on-failure',
              });
            }
            publish('failed');
            return;
          }
        }
        publish(results.some(result => result.status === 'failed') ? 'failed' : 'completed');
      } finally {
        pipelineRunningRef.current = false;
      }
    },
    [handleSend]
  );

  const handleSelectEnvironment = useCallback((id: string | null) => {
    useWorkspaceToolStore.getState().setActiveEnvironment(id);
  }, []);

  const handleManageEnvironment = useCallback((focus?: HttpEnvironmentFocus) => {
    setManagerFocus(focus ?? null);
    setIsManagerOpen(true);
  }, []);

  const history = <HttpResponseHistory history={activeHistory} selectedIndex={safeHistoryIndex} onSelect={setHistoryIndex} />;
  // Stacked, the history moves to the sidebar so the response keeps its height.
  const requestList = (
    <HttpRequestList
      requests={requests}
      activeRequestId={activeRequestId}
      onSelect={handleSelect}
      onCreate={handleCreate}
      onRename={handleRename}
      onDuplicate={handleDuplicate}
      onDelete={handleDelete}
      onOpenPipelines={() => setIsPipelineManagerOpen(true)}
      pipelineCount={pipelineCount}
      footer={columns ? undefined : history}
    />
  );
  const requestEditor = activeRequest ? (
    <HttpRequestEditor
      key={editorGeneration}
      request={activeRequest}
      onPatch={handlePatch}
      onSend={sendFromEditor}
      onStop={handleStop}
      isExecuting={isExecuting}
      environments={environments}
      activeEnvironmentId={activeEnvironmentId}
      onManageEnvironment={handleManageEnvironment}
      captureTargetRef={captureTargetRef}
      {...(activeResponse ? { response: activeResponse } : {})}
      latestResponse={snapshotsShown}
      {...(changes ? { snapshotChanges: changes.length } : {})}
      queue={queueFor(activeRequest)}
    />
  ) : (
    <HttpEmptyState onCreate={handleCreate} />
  );
  const responsePane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <HttpResponsePreview
          response={activeResponse}
          {...(activeRequest && isPristineRequest(activeRequest)
            ? { starters: <HttpStarterRequests onApply={starter => applyStarter(activeRequest, starter)} /> }
            : {})}
          isExecuting={isExecuting}
          requestSummary={
            activeRequest
              ? `${
                  activeRequest.transport === 'websocket'
                    ? 'WebSocket'
                    : activeRequest.transport === 'sse'
                      ? 'SSE'
                      : activeRequest.method
                } ${activeRequest.url}`
              : undefined
          }
          previous={activeHistory[safeHistoryIndex + 1]}
          captures={activeRequest?.captures}
          {...(activeRequest
            ? { onCaptureValue: (path: string, segments: readonly JsonSegment[]) => captureTargetRef.current?.(path, segments) }
            : {})}
          {...(activeRequest && snapshotsShown
            ? {
                snapshots: {
                  snapshot: activeRequest.snapshot,
                  changes: changes ?? [],
                  onChange: snapshot => useWorkspaceToolStore.getState().updateRequest(activeRequest.id, { snapshot }),
                },
              }
            : {})}
        />
      </div>
      {columns ? history : null}
    </div>
  );

  return (
    <div data-testid="http-workspace-panel" className="relative flex h-full min-w-0 flex-col">
      <CommandBarSlot slot="context">
        <HttpEnvironmentSelector
          environments={environments}
          activeEnvironmentId={activeEnvironmentId}
          onSelect={handleSelectEnvironment}
          onManage={() => handleManageEnvironment()}
          {...(environmentTint ? { tint: environmentTint } : {})}
        />
      </CommandBarSlot>
      <div ref={rootRef} data-testid="http-workspace-body" data-layout={columns ? 'columns' : 'stacked'} className="min-h-0 flex-1">
        {/* One tree for both layouts: only the orientation flips, so the editor and response keep their state. */}
        <Group
          orientation="horizontal"
          defaultLayout={sidebarLayout.defaultLayout}
          onLayoutChanged={sidebarLayout.onLayoutChanged}
          resizeTargetMinimumSize={RESIZE_TARGET}
          className="h-full"
        >
          <Panel id="http-request-list" defaultSize="20%" minSize={200} maxSize={360}>
            {requestList}
          </Panel>
          <ResizeHandle orientation="vertical" />
          <Panel id="http-request-main" defaultSize="80%" minSize={320}>
            <Group
              groupRef={mainGroupRef}
              orientation={split.axis}
              defaultLayout={mainLayout.defaultLayout}
              onLayoutChanged={mainLayout.onLayoutChanged}
              resizeTargetMinimumSize={RESIZE_TARGET}
              className="h-full"
            >
              <Panel id="http-request-editor" defaultSize={`${split.layout['http-request-editor']}%`} minSize={split.editorMin}>
                {requestEditor}
              </Panel>
              <ResizeHandle orientation={split.handle} />
              <Panel id="http-response-preview" defaultSize={`${split.layout['http-response-preview']}%`} minSize={split.responseMin}>
                <div className={cn('h-full border-border-subtle', split.border)}>{responsePane}</div>
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
      {isManagerOpen ? (
        <HttpEnvironmentManager
          environments={environments}
          onClose={() => setIsManagerOpen(false)}
          focus={managerFocus}
          onCreate={env => useWorkspaceToolStore.getState().createEnvironment(env)}
          onUpdate={(id, patch) => useWorkspaceToolStore.getState().updateEnvironment(id, patch)}
          onUpdateVariables={(id, updater) =>
            useWorkspaceToolStore.getState().updateEnvironmentVariables(id, updater)
          }
          onDelete={id => useWorkspaceToolStore.getState().deleteEnvironment(id)}
          onDuplicate={id =>
            useWorkspaceToolStore
              .getState()
              .duplicateEnvironment(
                id,
                crypto.randomUUID(),
                t('httpWorkspace.environment.manager.copySuffix')
              )
          }
          onExport={id => useWorkspaceToolStore.getState().exportEnvironmentJson(id)}
          onImport={json => useWorkspaceToolStore.getState().importEnvironmentJson(json)}
          scopes={{
            collectionVariables,
            onUpdateCollection: updater => useWorkspaceToolStore.getState().updateCollectionVariables(updater),
          }}
        />
      ) : null}
      {isPipelineManagerOpen ? (
        <HttpPipelineManager
          onClose={() => setIsPipelineManagerOpen(false)}
          run={pipelineRun}
          onRun={pipeline => void handleRunPipeline(pipeline)}
          onStop={handleStop}
        />
      ) : null}
    </div>
  );
}
