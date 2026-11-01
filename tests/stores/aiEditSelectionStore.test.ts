import { beforeEach, describe, expect, it } from 'vitest';
import { openEditSelectionForEditor, useAiEditSelectionStore } from '../../src/renderer/stores/aiEditSelectionStore';

type Editor = Parameters<typeof openEditSelectionForEditor>[0];

function makeEditor(value: string, selection: { start: number; end: number } | null): Editor {
  return {
    getModel: () => ({
      getValue: () => value,
      getOffsetAt: (position: { offset: number }) => position.offset,
      uri: { toString: () => 'inmemory://tab-1' },
      getVersionId: () => 7,
    }),
    getSelection: () =>
      selection
        ? { isEmpty: () => selection.start === selection.end, getStartPosition: () => ({ offset: selection.start }), getEndPosition: () => ({ offset: selection.end }) }
        : null,
  } as unknown as Editor;
}

describe('aiEditSelectionStore', () => {
  beforeEach(() => useAiEditSelectionStore.setState({ request: null }));

  it('opens on the selected span with the model it came from', () => {
    openEditSelectionForEditor(makeEditor('abc def ghi', { start: 4, end: 7 }), 'javascript', 'a.js');
    expect(useAiEditSelectionStore.getState().request).toEqual({
      code: 'abc def ghi',
      start: 4,
      end: 7,
      language: 'javascript',
      filename: 'a.js',
      modelUri: 'inmemory://tab-1',
      versionId: 7,
    });
  });

  it('takes the whole buffer when the selection is empty', () => {
    openEditSelectionForEditor(makeEditor('abc def', { start: 2, end: 2 }), 'python');
    expect(useAiEditSelectionStore.getState().request).toMatchObject({ start: 0, end: 7, language: 'python' });
    expect(useAiEditSelectionStore.getState().request).not.toHaveProperty('filename');
  });

  it('does nothing for an empty buffer', () => {
    openEditSelectionForEditor(makeEditor('  \n', null), 'javascript');
    expect(useAiEditSelectionStore.getState().request).toBeNull();
  });

  it('closes', () => {
    openEditSelectionForEditor(makeEditor('x', null), 'javascript');
    useAiEditSelectionStore.getState().close();
    expect(useAiEditSelectionStore.getState().request).toBeNull();
  });
});
