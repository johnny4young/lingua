import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmImportPreview } from '@/hooks/importPreviewConfirm';
import { previewImportSource } from '@/hooks/importPreviewModel';
import {
  HTTP_WORKSPACE_TAB_ID,
  useEditorStore,
} from '@/stores/editorStore';
import { useWorkspaceToolStore } from '@/stores/workspaceToolStore';

const trackEventMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: trackEventMock,
}));

beforeEach(() => {
  trackEventMock.mockClear();
  useWorkspaceToolStore.setState({
    requests: [],
    activeRequestId: null,
    responsesByRequestId: {},
    isExecutingActive: false,
  });
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

describe('importPreviewConfirm', () => {
  it('does not complete an idle or invalid confirmation', () => {
    expect(
      confirmImportPreview({ phase: 'idle', sourceBytes: 0 })
    ).toEqual({ completed: false, result: null });
  });

  it('completes a cURL confirmation and writes the HTTP workspace', () => {
    const state = previewImportSource(
      'curl -X PUT https://api.example.com/items/42 -d "{}"'
    );
    const outcome = confirmImportPreview(state);

    expect(outcome.completed).toBe(true);
    expect(outcome.result).toMatchObject({
      kind: 'curl-http',
      request: {
        method: 'PUT',
        url: 'https://api.example.com/items/42',
      },
    });
    expect(useWorkspaceToolStore.getState().requests).toHaveLength(1);
    expect(useEditorStore.getState().activeTabId).toBe(HTTP_WORKSPACE_TAB_ID);
  });

  it('marks a notebook entitlement rejection complete while returning null', () => {
    const state = previewImportSource(
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: { kernelspec: { language: 'python' } },
        cells: [
          { cell_type: 'code', source: ['print(1)'], outputs: [] },
        ],
      })
    );
    const addNotebookTab = vi
      .spyOn(useEditorStore.getState(), 'addNotebookTab')
      .mockReturnValue(null);

    expect(confirmImportPreview(state)).toEqual({
      completed: true,
      result: null,
    });
    expect(trackEventMock).toHaveBeenCalledWith('import.applied', {
      importerId: 'ipynb-notebook',
      status: 'cancelled',
      sizeBucket: expect.any(String),
    });
    addNotebookTab.mockRestore();
  });
});
