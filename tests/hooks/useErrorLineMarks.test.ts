import { act, renderHook } from '@testing-library/react';
import type * as monacoTypes from 'monaco-editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useErrorLineMarks } from '../../src/renderer/hooks/useErrorLineMarks';
import { useResultStore } from '../../src/renderer/stores/resultStore';

function fakeEditor() {
  const sets: monacoTypes.editor.IModelDeltaDecoration[][] = [];
  const clear = vi.fn();
  const editor = {
    getModel: () => ({ getLineCount: () => 5 }),
    createDecorationsCollection: (initial: monacoTypes.editor.IModelDeltaDecoration[]) => {
      sets.push(initial);
      return { set: (next: monacoTypes.editor.IModelDeltaDecoration[]) => sets.push(next), clear };
    },
  };
  const monaco = { Range: class { constructor(public startLineNumber: number) {} } };
  return { editor: editor as unknown as monacoTypes.editor.IStandaloneCodeEditor, monaco: monaco as unknown as typeof monacoTypes, sets, clear };
}

beforeEach(() => useResultStore.setState({ error: null }));

describe('error line marks', () => {
  it('tints the failing line and marks the glyph margin, and clears with the error', () => {
    const fake = fakeEditor();
    renderHook(() => useErrorLineMarks(fake.editor, fake.monaco));
    expect(fake.sets).toHaveLength(0);
    act(() => useResultStore.setState({ error: { message: 'x', line: 3 } }));
    expect(fake.sets.at(-1)).toEqual([
      expect.objectContaining({ range: expect.objectContaining({ startLineNumber: 3 }), options: { isWholeLine: true, className: 'lingua-error-line', glyphMarginClassName: 'lingua-error-glyph' } }),
    ]);
    act(() => useResultStore.setState({ error: { message: 'x', line: 9 } }));
    expect(fake.clear).toHaveBeenCalled();
  });
});
