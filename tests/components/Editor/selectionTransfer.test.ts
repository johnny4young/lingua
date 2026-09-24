import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as monaco from 'monaco-editor';
import {
  buildSelectionTransfer,
  copyEditorSelection,
  hasExplicitSelection,
  registerSelectionTransferActions,
} from '../../../src/renderer/utils/selectionTransfer';

const tab = {
  name: 'main.ts',
  language: 'typescript' as const,
  filePath: '/Users/alice/private/project/src/main.ts',
  rootId: 'grant',
  relativePath: 'src/main.ts',
};

function editorWithSelection(text: string, endLine = 4, endColumn = 1) {
  const selection = {
    isEmpty: () => text.length === 0,
    startLineNumber: 2,
    endLineNumber: endLine,
    endColumn,
  };
  const model = {
    getValueInRange: vi.fn().mockReturnValue(text),
    getValue: vi.fn(() => { throw new Error('whole-buffer read is forbidden'); }),
  };
  const editor = {
    getSelection: vi.fn().mockReturnValue(selection),
    getModel: vi.fn().mockReturnValue(model),
  } as unknown as monaco.editor.IStandaloneCodeEditor;
  return { editor, model };
}

describe('selection transfer privacy boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('copies only explicit selected CRLF text and a relative line reference', () => {
    const { editor, model } = editorWithSelection('const x = 1;\r\nconsole.log(x);\r\n');
    expect(hasExplicitSelection(editor)).toBe(true);
    const text = buildSelectionTransfer(editor, tab, 'context');
    expect(text).toBe('src/main.ts:2-3\n```ts\nconst x = 1;\r\nconsole.log(x);\r\n```');
    expect(model.getValueInRange).toHaveBeenCalledOnce();
    expect(model.getValue).not.toHaveBeenCalled();
    expect(text).not.toContain('/Users/alice');
  });

  it('uses a longer fence when selected code contains a fenced block', () => {
    const { editor } = editorWithSelection('```js\nalert(1)\n```', 4, 4);
    expect(buildSelectionTransfer(editor, tab, 'context')).toBe(
      'src/main.ts:2-4\n````ts\n```js\nalert(1)\n```\n````'
    );
  });

  it('uses only the sanitized tab basename when a project-relative path is unavailable or unsafe', () => {
    const { editor } = editorWithSelection('private', 2, 8);
    const unsafe = { ...tab, name: 'C:\\Users\\alice\\secret.ts', relativePath: '../secret.ts' };
    expect(buildSelectionTransfer(editor, unsafe, 'reference')).toBe('secret.ts:2');
    expect(buildSelectionTransfer(editor, { ...unsafe, relativePath: '/tmp/secret.ts' }, 'reference'))
      .toBe('secret.ts:2');
  });

  it('disables transfer and never reads the model or clipboard when selection is empty', async () => {
    const { editor, model } = editorWithSelection('');
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write } });
    expect(hasExplicitSelection(editor)).toBe(false);
    expect(buildSelectionTransfer(editor, tab, 'context')).toBeNull();
    expect(await copyEditorSelection(editor, tab, 'context')).toBe('no-selection');
    expect(model.getValueInRange).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('does not report success when the clipboard denies a write', async () => {
    const { editor } = editorWithSelection('secret', 2, 7);
    const write = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write } });
    expect(await copyEditorSelection(editor, tab, 'context')).toBe('clipboard-unavailable');
    expect(write).toHaveBeenCalledOnce();
  });

  it('registers both Free actions as selection-only Monaco menu entries', () => {
    const { editor } = editorWithSelection('selected', 2, 9);
    const actions: Array<{ id: string; precondition?: string; run: (editor: unknown) => void }> = [];
    const dispose = vi.fn();
    const addAction = vi.fn((action: typeof actions[number]) => {
      actions.push(action);
      return { dispose };
    });
    const source = { ...editor, addAction } as monaco.editor.IStandaloneCodeEditor;
    const cleanup = registerSelectionTransferActions(source, () => tab, {
      reference: 'Copy reference', context: 'Copy with context',
    });
    expect(actions.map(action => action.id)).toEqual([
      'lingua.selection.copy-reference', 'lingua.selection.copy-context',
    ]);
    expect(actions.every(action => action.precondition === 'editorHasSelection')).toBe(true);
    cleanup();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
