/**
 * RL-100 Slice 1 — `useImportPreview` hook tests.
 *
 * Drives the detect → preview → import lifecycle in jsdom + asserts
 * the store / bottom-panel side effects on confirm (fold G).
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useImportPreview } from '../../src/renderer/hooks/useImportPreview';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useWorkspaceToolStore } from '../../src/renderer/stores/workspaceToolStore';

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
