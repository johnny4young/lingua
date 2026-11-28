import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as monacoTypes from 'monaco-editor';
import { EditorHandoffRow } from '@/components/DeveloperUtilities/EditorHandoffRow';
import { insertIntoCodeTab, resolveInsertTarget } from '@/components/DeveloperUtilities/editorHandoff';
import { rememberCodeCursor } from '@/runtime/editorAccess';
import { applyEditorInsert, useEditorInsertStore } from '@/runtime/editorInsert';
import { useEditorStore } from '@/stores/editorStore';
import { useLicenseStore } from '@/stores/licenseStore';
import type { FileTab } from '@/types/editor';

const tab = (id: string, content: string, extra: Partial<FileTab> = {}): FileTab =>
  ({ id, name: `${id}.ts`, language: 'typescript', content, isDirty: false, ...extra }) as FileTab;

const AUTH = tab('auth', 'const a = 1;\nconst b = 2;\n');
const UTILITIES = tab('utilities', '', { kind: 'utilities', name: 'Utilities' });

interface Position {
  lineNumber: number;
  column: number;
}

/** A Monaco stand-in over one string, enough for an insert, its tint and its note. */
function fakeEditor(initial: string) {
  let text = initial;
  const lines = () => text.split('\n');
  const offsetAt = ({ lineNumber, column }: Position) =>
    lines().slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + column - 1;
  const positionAt = (offset: number): Position => {
    let rest = offset;
    const all = lines();
    for (let index = 0; index < all.length; index += 1) {
      const length = all[index]?.length ?? 0;
      if (rest <= length) return { lineNumber: index + 1, column: rest + 1 };
      rest -= length + 1;
    }
    return { lineNumber: all.length, column: (all.at(-1)?.length ?? 0) + 1 };
  };
  const contentListeners = new Set<() => void>();
  const zones = new Map<string, monacoTypes.editor.IViewZone>();
  const tint = { clear: vi.fn() };
  const model = {
    getValue: () => text,
    getEOL: () => '\n',
    validatePosition: (position: Position) => {
      const lineNumber = Math.min(Math.max(position.lineNumber, 1), lines().length);
      return { lineNumber, column: Math.min(Math.max(position.column, 1), (lines()[lineNumber - 1]?.length ?? 0) + 1) };
    },
    getOffsetAt: offsetAt,
    getPositionAt: positionAt,
  };
  const listen = (set: Set<() => void>) => (listener: () => void) => {
    set.add(listener);
    return { dispose: () => set.delete(listener) };
  };
  const editor = {
    getModel: () => model,
    pushUndoStop: vi.fn(),
    executeEdits: vi.fn((_source: string, edits: Array<{ range: { start: Position }; text: string }>) => {
      for (const edit of edits) {
        const at = offsetAt(edit.range.start);
        text = text.slice(0, at) + edit.text + text.slice(at);
      }
      for (const listener of contentListeners) listener();
      return true;
    }),
    setPosition: vi.fn(),
    revealRangeInCenterIfOutsideViewport: vi.fn(),
    focus: vi.fn(),
    getOption: () => 20,
    createDecorationsCollection: vi.fn(() => tint),
    changeViewZones: (callback: (accessor: { addZone: (zone: monacoTypes.editor.IViewZone) => string; removeZone: (id: string) => void }) => void) =>
      callback({
        addZone: (zone) => {
          const id = String(zones.size + 1);
          zones.set(id, zone);
          document.body.appendChild(zone.domNode);
          return id;
        },
        removeZone: (id) => {
          zones.get(id)?.domNode.remove();
          zones.delete(id);
        },
      }),
    onDidChangeModelContent: listen(contentListeners),
    onDidChangeModel: listen(new Set()),
    onDidDispose: listen(new Set()),
    type: (value: string) => {
      text += value;
      for (const listener of contentListeners) listener();
    },
  };
  return { editor, zones, tint, text: () => text };
}

const fakeMonaco = {
  Range: class {
    static fromPositions(start: Position, end: Position = start) {
      return { start, end };
    }
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number
    ) {}
  },
  editor: { EditorOption: { lineHeight: 75 } },
} as unknown as typeof monacoTypes;

beforeEach(() => {
  useEditorStore.setState({ tabs: [AUTH, UTILITIES], activeTabId: 'utilities' });
  useEditorInsertStore.setState({ request: null });
});

afterEach(() => {
  cleanup();
});

describe('resolveInsertTarget', () => {
  it('lands where the cursor last sat in a code tab, clamped to its text', () => {
    expect(resolveInsertTarget([AUTH, UTILITIES], { tabId: 'auth', line: 2, column: 7 })).toEqual({ tabId: 'auth', name: 'auth.ts', line: 2, column: 7 });
    expect(resolveInsertTarget([AUTH], { tabId: 'auth', line: 40, column: 90 })).toEqual({ tabId: 'auth', name: 'auth.ts', line: 3, column: 1 });
    const crlf = tab('crlf', 'abc\r\nde\r\n');
    expect(resolveInsertTarget([crlf], { tabId: 'crlf', line: 1, column: 90 })).toMatchObject({ line: 1, column: 4 });
  });

  it('falls back to the end of the last code tab once the remembered tab is gone', () => {
    const other = tab('other', 'x\nlast line');
    expect(resolveInsertTarget([other, UTILITIES], { tabId: 'auth', line: 1, column: 1 })).toEqual({ tabId: 'other', name: 'other.ts', line: 2, column: 10 });
  });

  it('finds nothing without a code tab', () => {
    expect(resolveInsertTarget([UTILITIES, tab('nb', '', { kind: 'notebook' })], null)).toBeNull();
  });
});

describe('insertIntoCodeTab', () => {
  it('opens the tab and queues the insert; the editor applies it as one undo step and notes the tool until the next edit', async () => {
    const { editor, zones, tint, text } = fakeEditor(AUTH.content);
    insertIntoCodeTab({ tabId: 'auth', name: 'auth.ts', line: 2, column: 1 }, '{\n  "sub": 1\n}\n', { utilityId: 'jwt', tool: 'JWT Debugger' });
    expect(useEditorStore.getState().activeTabId).toBe('auth');
    const request = useEditorInsertStore.getState().request;
    expect(request).toMatchObject({ tabId: 'auth', line: 2, column: 1 });
    act(() => applyEditorInsert(editor as unknown as monacoTypes.editor.IStandaloneCodeEditor, fakeMonaco, request!));

    expect(text()).toBe('const a = 1;\n{\n  "sub": 1\n}\nconst b = 2;\n');
    expect(editor.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(editor.executeEdits).toHaveBeenCalledTimes(1);
    const tinted = editor.createDecorationsCollection.mock.calls[0]?.[0] as unknown as Array<{ range: { startLineNumber: number; endLineNumber: number } }>;
    expect(tinted[0]?.range).toMatchObject({ startLineNumber: 2, endLineNumber: 4 });
    expect([...zones.values()][0]).toMatchObject({ afterLineNumber: 4, heightInPx: 28 });
    await vi.waitFor(() => expect(screen.getByTestId('utility-inserted-note').textContent).toMatch(/Inserted from JWT Debugger.*undo/u));

    act(() => editor.type('x'));
    expect(zones.size).toBe(0);
    expect(tint.clear).toHaveBeenCalled();
  });
});

describe('EditorHandoffRow', () => {
  const row = (output: string) => (
    <EditorHandoffRow output={output} ready utilityId="jwt" tool="JWT Debugger" active />
  );

  it('names the last code tab and line, and opens a JSON output as a tab', () => {
    // JSON tabs are a Pro language, as for the large-JSON paste.
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
            issuedTo: 'handoff@example.com',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
            entitlements: [],
          },
        },
      },
      lastVerifiedAt: Date.now(),
    });
    rememberCodeCursor({ tabId: 'auth', line: 2, column: 3 });
    render(row('{"sub":"lingua"}'));
    expect(screen.getByTestId('utility-insert-target').textContent).toBe('auth.ts · line 2');

    fireEvent.click(screen.getByTestId('utility-open-json-tab'));
    const opened = useEditorStore.getState().tabs.at(-1);
    expect(opened).toMatchObject({ language: 'json', content: '{"sub":"lingua"}' });
  });

  it('offers only the JSON tab without a code tab, and nothing for text with none', () => {
    useEditorStore.setState({ tabs: [UTILITIES], activeTabId: 'utilities' });
    const { rerender } = render(row('[1]'));
    expect(screen.queryByTestId('utility-insert-at-cursor')).toBeNull();
    screen.getByTestId('utility-open-json-tab');

    rerender(row('5f61e9cabe'));
    expect(screen.queryByTestId('utility-editor-handoff')).toBeNull();
  });

  it('offers the insert but no JSON tab for a text output', () => {
    render(row('5f61e9cabe'));
    screen.getByTestId('utility-insert-at-cursor');
    expect(screen.queryByTestId('utility-open-json-tab')).toBeNull();
  });
});
