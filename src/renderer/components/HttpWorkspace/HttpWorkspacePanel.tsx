/**
 * RL-097 Slice 1 — Root component of the HTTP workspace bottom-panel
 * tab. Three-column layout (request list | editor | response).
 *
 * Wires the store actions, the runtime execution path, the capsule
 * builder, and the telemetry emit. Each sub-component stays
 * purely presentational; the orchestration lives here.
 */

import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceToolStore } from '../../stores/workspaceToolStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { getBundledAppInfo } from '../../../shared/appInfo';
import {
  createBlankHttpRequest,
  type HttpRequestV1,
} from '../../../shared/httpWorkspace';
import { executeHttpRequest } from '../../runtime/httpClient';
import { buildHttpResponseCapsule } from '../../runtime/httpResponseCapsule';
import { trackHttpRequestExecuted } from '../../hooks/httpWorkspaceTelemetry';
import { HttpRequestList } from './HttpRequestList';
import { HttpRequestEditor } from './HttpRequestEditor';
import { HttpResponsePreview } from './HttpResponsePreview';

export function HttpWorkspacePanel() {
  const { t } = useTranslation();
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
  const isExecuting = useWorkspaceToolStore((state) => state.isExecutingActive);
  const responsesByRequestId = useWorkspaceToolStore(
    (state) => state.responsesByRequestId
  );
  const sensitiveHttpHeaders = useSettingsStore(
    (state) => state.sensitiveHttpHeaders
  );

  const activeRequest: HttpRequestV1 | undefined = useMemo(
    () => requests.find((r) => r.id === activeRequestId),
    [requests, activeRequestId]
  );
  const activeResponse = activeRequest
    ? responsesByRequestId[activeRequest.id]?.[0]
    : undefined;

  const handleCreate = useCallback(() => {
    // Default name stays empty (not localised) so a user switching
    // language never sees a bilingual list. The list renderer falls
    // back to the localised placeholder for unnamed requests.
    const req = createBlankHttpRequest({
      id: crypto.randomUUID(),
      name: '',
    });
    useWorkspaceToolStore.getState().createRequest(req);
  }, []);

  const handleSelect = useCallback((id: string) => {
    useWorkspaceToolStore.getState().setActiveRequest(id);
  }, []);

  const handleRename = useCallback((id: string, name: string) => {
    useWorkspaceToolStore.getState().updateRequest(id, { name });
  }, []);

  const handleDelete = useCallback((id: string) => {
    useWorkspaceToolStore.getState().deleteRequest(id);
  }, []);

  const handlePatch = useCallback(
    (patch: Partial<HttpRequestV1>) => {
      if (!activeRequest) return;
      useWorkspaceToolStore.getState().updateRequest(activeRequest.id, patch);
    },
    [activeRequest]
  );

  const handleSend = useCallback(async (requestToSend: HttpRequestV1) => {
    if (useWorkspaceToolStore.getState().isExecutingActive) return;
    useWorkspaceToolStore.getState().setIsExecutingActive(true);
    try {
      const response = await executeHttpRequest(requestToSend, {
        userSensitiveHeaders: sensitiveHttpHeaders,
      });
      useWorkspaceToolStore
        .getState()
        .recordResponse(requestToSend.id, response);
      trackHttpRequestExecuted(requestToSend.method, response);
      let capsule;
      try {
        const appInfo = getBundledAppInfo();
        const platform: 'web' | 'desktop' =
          typeof window !== 'undefined' && window.lingua?.platform === 'desktop'
            ? 'desktop'
            : 'web';
        capsule = await buildHttpResponseCapsule({
          appVersion: appInfo.version,
          requestName: requestToSend.name,
          request: requestToSend,
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
      useWorkspaceToolStore.getState().setIsExecutingActive(false);
    }
  }, [sensitiveHttpHeaders]);

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
            onDelete={handleDelete}
          />
        </Panel>
        <Panel id="http-request-editor" defaultSize="50%" minSize={320}>
          {activeRequest ? (
            <HttpRequestEditor
              request={activeRequest}
              onPatch={handlePatch}
              onSend={handleSend}
              isExecuting={isExecuting}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-6 text-center">
              <div className="text-sm font-medium">
                {t('httpWorkspace.empty.title')}
              </div>
              <div className="text-xs text-muted">
                {t('httpWorkspace.empty.body')}
              </div>
            </div>
          )}
        </Panel>
        <Panel id="http-response-preview" defaultSize="30%" minSize={220}>
          <HttpResponsePreview
            response={activeResponse}
            isExecuting={isExecuting}
          />
        </Panel>
      </Group>
    </div>
  );
}
