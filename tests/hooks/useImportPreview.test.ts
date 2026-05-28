/**
 * RL-100 Slice 1 — `useImportPreview` hook tests.
 *
 * Drives the detect → preview → import lifecycle in jsdom + asserts
 * the store / bottom-panel side effects on confirm (fold G).
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bucketWarningKindCount,
  countDistinctNotebookWarningKinds,
  deriveDominantNotebookWarning,
} from '../../src/renderer/hooks/importTelemetry';
import { useImportPreview } from '../../src/renderer/hooks/useImportPreview';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
import { useNotebookStore } from '../../src/renderer/stores/notebookStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useWorkspaceToolStore } from '../../src/renderer/stores/workspaceToolStore';

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

  it('confirm writes a new request into the workspace store + flips bottom-panel (fold G)', () => {
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
    const requests = useWorkspaceToolStore.getState().requests;
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe('https://api.example.com/items/42');
    expect(useUIStore.getState().activeBottomPanel).toBe('http');
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

  it('confirm writes every collection request into the workspace + flips http panel (Slice 3)', () => {
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
    const { requests, activeRequestId } = useWorkspaceToolStore.getState();
    expect(requests).toHaveLength(2);
    expect(requests[0]?.name).toBe('List');
    expect(activeRequestId).toBe(requests[0]?.id);
    expect(useUIStore.getState().activeBottomPanel).toBe('http');
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
});
