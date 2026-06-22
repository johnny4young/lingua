/**
 * RL-100 Slice 1 — `useImportPreview` hook tests.
 *
 * Drives the detect → preview → import lifecycle in jsdom + asserts
 * the store / bottom-panel side effects on confirm (fold G).
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bucketImportVariableCount,
  bucketWarningKindCount,
  countDistinctNotebookWarningKinds,
  deriveDominantNotebookWarning,
} from '../../src/renderer/hooks/importTelemetry';
import { useImportPreview } from '../../src/renderer/hooks/useImportPreview';
import { serializeNotebookDocument } from '../../src/shared/notebookDocument';
import type { NotebookV1 } from '../../src/shared/notebook';
import {
  useEditorStore,
  HTTP_WORKSPACE_TAB_ID,
} from '../../src/renderer/stores/editorStore';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
import { useNotebookStore } from '../../src/renderer/stores/notebookStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useWorkspaceToolStore } from '../../src/renderer/stores/workspaceToolStore';

const trackEventMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: trackEventMock,
}));

function seedProTier() {
  // RL-100 Slice 2 — `addNotebookTab` gates on the NOTEBOOK_MODE
  // entitlement (Pro+). Seed a Pro license so the ipynb confirm flow
  // can mint a tab in the test environment. Mirrors the pattern in
  // `tests/stores/editorStore.test.ts`.
  useLicenseStore.setState({
    token: 'test.token',
    status: {
      kind: 'active',
      verification: {
        ok: true,
        state: 'active',
        supportWindowEndsAt: Date.now() + 86_400_000,
        payload: {
          productId: 'lingua-desktop',
          tier: 'pro',
          issuedTo: 'test@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

beforeEach(() => {
  localStorage.clear();
  trackEventMock.mockClear();
  // Reset workspace tool store so each test starts from a clean
  // requests list.
  useWorkspaceToolStore.setState({
    requests: [],
    activeRequestId: null,
    responsesByRequestId: {},
    isExecutingActive: false,
  });
  useUIStore.setState({ activeBottomPanel: 'console' });
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useNotebookStore.setState({ notebooks: {} });
  seedProTier();
});

describe('useImportPreview', () => {
  it('starts in idle phase with empty warnings', () => {
    const { result } = renderHook(() => useImportPreview());
    expect(result.current.state.phase).toBe('idle');
    expect(result.current.warnings).toEqual([]);
  });

  it('moves to rejected when given empty input', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource('   ');
    });
    expect(result.current.state.phase).toBe('rejected');
    expect(result.current.state.reason).toBe('empty-input');
  });

  it('moves to rejected when given non-cURL input', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource('GET / HTTP/1.1');
    });
    expect(result.current.state.phase).toBe('rejected');
    expect(result.current.state.reason).toBe('unrecognized-format');
  });

  it('moves to previewed for a valid cURL command', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(
        'curl -X POST https://api.example.com/x -d "{}"'
      );
    });
    expect(result.current.state.phase).toBe('previewed');
    expect(result.current.state.importerId).toBe('curl-http');
    expect(result.current.state.preview?.original.method).toBe('POST');
  });

  it('surfaces lossy warnings (fold C)', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(
        'curl -u user:pass https://api.example.com/me'
      );
    });
    expect(result.current.warnings).toContain('curl-basic-auth');
  });

  it('confirm writes a request + opens a full-screen HTTP tab (fold G, MOV.02)', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(
        'curl -X PUT https://api.example.com/items/42 -d \'{"a":1}\''
      );
    });
    let returned;
    act(() => {
      returned = result.current.confirm();
    });
    expect(returned).not.toBeNull();
    // SQL/HTTP MODEL rework — the imported request lands in the HTTP
    // collection workspace (its own id), and the single HTTP workspace
    // tab is opened/focused. The importer does NOT mint a per-request
    // tab; instead it marks the imported request active so the rail
    // selects it.
    const requests = useWorkspaceToolStore.getState().requests;
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe('https://api.example.com/items/42');
    // Exactly one HTTP workspace tab exists, on the stable id, active.
    const { tabs, activeTabId } = useEditorStore.getState();
    const httpTabs = tabs.filter((tab) => tab.kind === 'http');
    expect(httpTabs).toHaveLength(1);
    expect(httpTabs[0]?.id).toBe(HTTP_WORKSPACE_TAB_ID);
    expect(activeTabId).toBe(HTTP_WORKSPACE_TAB_ID);
    // The rail selects the imported request (the collection's active id),
    // which is the request's OWN id, not the workspace tab id.
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe(
      requests[0]?.id
    );
  });

  it('confirm is a no-op when phase is not previewed', () => {
    const { result } = renderHook(() => useImportPreview());
    let returned;
    act(() => {
      returned = result.current.confirm();
    });
    expect(returned).toBeNull();
    expect(useWorkspaceToolStore.getState().requests).toHaveLength(0);
  });

  it('reset clears the preview state back to idle', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource('curl https://example.com');
    });
    expect(result.current.state.phase).toBe('previewed');
    act(() => {
      result.current.reset();
    });
    expect(result.current.state.phase).toBe('idle');
  });
});

describe('useImportPreview — ipynb arm (RL-100 Slice 2)', () => {
  const sampleIpynb = JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { language: 'python' } },
    cells: [
      { cell_type: 'markdown', source: ['# Hello'] },
      { cell_type: 'code', source: ["print('hi')"], outputs: [] },
    ],
  });

  it('detects + previews an .ipynb payload as kind notebook', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(sampleIpynb);
    });
    expect(result.current.state.phase).toBe('previewed');
    expect(result.current.state.importerId).toBe('ipynb-notebook');
    expect(result.current.state.preview?.kind).toBe('ipynb-notebook');
  });

  it('rejects an .ipynb with nbformat: 3 carrying the wrong-version detail', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(
        JSON.stringify({ nbformat: 3, cells: [] })
      );
    });
    expect(result.current.state.phase).toBe('rejected');
    expect(result.current.state.reason).toBe('unsupported-feature');
    expect(result.current.state.rejectDetail).toBe('wrong-version');
  });

  it('confirm writes the notebook into stores + does NOT flip http panel', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(sampleIpynb);
    });
    let returned: ReturnType<typeof result.current.confirm> = null;
    act(() => {
      returned = result.current.confirm();
    });
    expect(returned).not.toBeNull();
    expect(returned?.kind).toBe('ipynb-notebook');
    expect(returned?.notebookTabId).toBeDefined();
    expect(returned?.dominantLanguage).toBe('python');
    expect(
      useEditorStore
        .getState()
        .tabs.find((tab) => tab.id === returned?.notebookTabId)?.language
    ).toBe('python');
    // Bottom panel NOT flipped to http (only curl-http does that).
    expect(useUIStore.getState().activeBottomPanel).toBe('console');
  });

  it('confirm writes every collection request + opens a full-screen HTTP tab (Slice 3, MOV.02)', () => {
    const postman = JSON.stringify({
      info: {
        name: 'Demo',
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        { name: 'List', request: { method: 'GET', url: 'https://x.dev/a' } },
        { name: 'Create', request: { method: 'POST', url: 'https://x.dev/a' } },
      ],
    });
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(postman);
    });
    expect(result.current.state.importerId).toBe('postman-collection');
    let returned: ReturnType<typeof result.current.confirm> = null;
    act(() => {
      returned = result.current.confirm();
    });
    expect(returned?.kind).toBe('postman-collection');
    expect(returned?.requestCount).toBe(2);
    // SQL/HTTP MODEL rework — every imported request lands in the HTTP
    // collection (each keeps its own id); `createRequests` selects the
    // first. A single HTTP workspace tab (stable id) is opened/focused —
    // never one tab per request. The rail surfaces all of them.
    const { requests, activeRequestId } = useWorkspaceToolStore.getState();
    expect(requests).toHaveLength(2);
    expect(requests[0]?.name).toBe('List');
    expect(activeRequestId).toBe(requests[0]?.id);
    const { tabs, activeTabId } = useEditorStore.getState();
    const httpTabs = tabs.filter((tab) => tab.kind === 'http');
    expect(httpTabs).toHaveLength(1);
    expect(httpTabs[0]?.id).toBe(HTTP_WORKSPACE_TAB_ID);
    expect(activeTabId).toBe(HTTP_WORKSPACE_TAB_ID);
  });

  it('does not attribute unrecognized rejects to cURL when cancelled', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource('{"not":"an importer"}');
    });
    expect(result.current.state.phase).toBe('rejected');
    expect(result.current.state.importerId).toBeUndefined();

    act(() => {
      result.current.trackCancelled();
    });

    expect(result.current.state.phase).toBe('idle');
  });

  it('fires bucketed Postman variable telemetry after a resolved collection import', () => {
    const postman = JSON.stringify({
      info: {
        name: 'Vars',
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      variable: [{ key: 'baseUrl', value: 'api.example.com' }],
      item: [
        {
          name: 'List',
          request: {
            method: 'GET',
            url: 'https://{{baseUrl}}/{{missingPath}}',
          },
        },
      ],
    });
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(postman);
    });

    act(() => {
      result.current.confirm();
    });

    expect(trackEventMock).toHaveBeenCalledWith('import.applied', {
      importerId: 'postman-collection',
      status: 'ok',
      sizeBucket: expect.any(String),
    });
    expect(trackEventMock).toHaveBeenCalledWith(
      'import.postman_variables_resolved',
      {
        resolvedBucket: '1',
        unresolvedBucket: '1',
      }
    );
  });
});

describe('useImportPreview — .linguanb arm (RL-043 Slice E)', () => {
  const linguanbNotebook: NotebookV1 = {
    version: 1,
    id: 'nb-saved',
    title: 'Saved Notebook',
    createdAt: '2026-06-20T00:00:00.000Z',
    cells: [
      { kind: 'markdown', id: 'm1', source: '# Notes' },
      { kind: 'code', id: 'c1', language: 'typescript', source: 'const a: number = 1;', outputs: [] },
    ],
  };
  const sampleLinguanb = serializeNotebookDocument(linguanbNotebook, {
    executionOrder: { c1: 3 },
  });

  it('detects + previews a .linguanb payload as kind linguanb-notebook', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(sampleLinguanb);
    });
    expect(result.current.state.phase).toBe('previewed');
    expect(result.current.state.importerId).toBe('linguanb-notebook');
    expect(result.current.state.preview?.kind).toBe('linguanb-notebook');
  });

  it('confirm installs the notebook losslessly (preserves cell ids + restores [N]) — fold B/F', () => {
    const { result } = renderHook(() => useImportPreview());
    act(() => {
      result.current.previewSource(sampleLinguanb);
    });
    let returned: ReturnType<typeof result.current.confirm> = null;
    act(() => {
      returned = result.current.confirm();
    });
    expect(returned?.kind).toBe('linguanb-notebook');
    const tabId = returned?.notebookTabId;
    expect(tabId).toBeDefined();
    if (!tabId) return;
    const installed = useNotebookStore.getState().getNotebookForTab(tabId);
    // Lossless — the document's own cell ids survive (no regeneration).
    expect(installed?.cells.map((c) => c.id)).toEqual(['m1', 'c1']);
    expect(installed?.title).toBe('Saved Notebook');
    // Fold B — the [N] execution stamp is restored into the store.
    expect(useNotebookStore.getState().getCellExecutionOrder(tabId, 'c1')).toBe(3);
  });
});

describe('import notebook warning telemetry helpers', () => {
  it('derives the dominant warning from occurrences, not unique codes', () => {
    expect(
      deriveDominantNotebookWarning([
        'ipynb-raw-cell-dropped',
        'ipynb-rich-output-dropped',
        'ipynb-rich-output-dropped',
      ])
    ).toBe('rich-output-dropped');
  });

  it('counts only distinct notebook warning kinds for the privacy bucket', () => {
    expect(
      countDistinctNotebookWarningKinds([
        'ipynb-raw-cell-dropped',
        'ipynb-rich-output-dropped',
        'ipynb-rich-output-dropped',
        'curl-basic-auth',
      ])
    ).toBe(2);
  });

  it('buckets warning-kind counts with the dependency-count ladder', () => {
    expect(bucketWarningKindCount(0)).toBe('0');
    expect(bucketWarningKindCount(1)).toBe('1');
    expect(bucketWarningKindCount(5)).toBe('2-5');
    expect(bucketWarningKindCount(6)).toBe('6-10');
    expect(bucketWarningKindCount(11)).toBe('>10');
  });

  it('buckets Postman variable counts on the same dependency-count ladder (fold B)', () => {
    expect(bucketImportVariableCount(0)).toBe('0');
    expect(bucketImportVariableCount(1)).toBe('1');
    expect(bucketImportVariableCount(4)).toBe('2-5');
    expect(bucketImportVariableCount(9)).toBe('6-10');
    expect(bucketImportVariableCount(25)).toBe('>10');
  });
});
