import { beforeEach, describe, expect, it } from 'vitest';
import {
  openExplainCodeForEditor,
  useAiExplainCodeStore,
} from '../../src/renderer/stores/aiExplainCodeStore';

type Editor = Parameters<typeof openExplainCodeForEditor>[0];

/** Minimal Monaco editor stub exposing only what the helper reads. */
function makeEditor(opts: {
  value: string;
  selectionText?: string | null;
}): Editor {
  const selectionEmpty = opts.selectionText == null;
  return {
    getModel: () => ({
      getValue: () => opts.value,
      getValueInRange: () => opts.selectionText ?? '',
    }),
    getSelection: () =>
      selectionEmpty ? { isEmpty: () => true } : { isEmpty: () => false },
  } as unknown as Editor;
}

describe('aiExplainCodeStore (SR-20a Wave 4)', () => {
  beforeEach(() => {
    useAiExplainCodeStore.setState({ request: null });
  });

  it('opens with the selection when one exists', () => {
    openExplainCodeForEditor(
      makeEditor({ value: 'WHOLE BUFFER', selectionText: 'SELECTED' }),
      'javascript',
      'scratch.js'
    );
    expect(useAiExplainCodeStore.getState().request).toEqual({
      code: 'SELECTED',
      language: 'javascript',
      filename: 'scratch.js',
    });
  });

  it('falls back to the whole buffer when nothing is selected', () => {
    openExplainCodeForEditor(
      makeEditor({ value: 'WHOLE BUFFER', selectionText: null }),
      'python'
    );
    expect(useAiExplainCodeStore.getState().request).toEqual({
      code: 'WHOLE BUFFER',
      language: 'python',
    });
  });

  it('is a no-op for an empty buffer', () => {
    openExplainCodeForEditor(
      makeEditor({ value: '   \n', selectionText: null }),
      'javascript'
    );
    expect(useAiExplainCodeStore.getState().request).toBeNull();
  });

  it('close clears the request', () => {
    useAiExplainCodeStore.getState().open({ code: 'x', language: 'js' });
    useAiExplainCodeStore.getState().close();
    expect(useAiExplainCodeStore.getState().request).toBeNull();
  });
});
