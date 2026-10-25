import { act, renderHook } from '@testing-library/react';
import type * as monacoTypes from 'monaco-editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBreakpointGutter } from '../../src/renderer/hooks/useBreakpointGutter';
import { useDebuggerStore } from '../../src/renderer/stores/debuggerStore';

type Decoration = monacoTypes.editor.IModelDeltaDecoration;

function fakeEditor() {
  let mouseDown: ((event: unknown) => void) | null = null;
  const decorations: Decoration[][] = [];
  const editor = {
    createDecorationsCollection: vi.fn((initial: Decoration[]) => {
      decorations.push(initial);
      return { set: (next: Decoration[]) => decorations.push(next), clear: vi.fn() };
    }),
    onMouseDown: (handler: (event: unknown) => void) => {
      mouseDown = handler;
      return { dispose: vi.fn() };
    },
    revealLineInCenterIfOutsideViewport: vi.fn(),
    setPosition: vi.fn(),
  };
  const monaco = {
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number
      ) {}
    },
    editor: { MouseTargetType: { GUTTER_GLYPH_MARGIN: 2 } },
  };
  const click = (line: number, altKey = false) =>
    act(() => mouseDown?.({ target: { type: 2, position: { lineNumber: line } }, event: { altKey } }));
  const latest = () => decorations.at(-1) ?? [];
  return {
    editor: editor as unknown as monacoTypes.editor.IStandaloneCodeEditor,
    monaco: monaco as unknown as typeof monacoTypes,
    click,
    latest,
  };
}

const label = (line: number, modes: boolean) => `line ${line} ${modes ? 'modes' : 'pause only'}`;

function mount(language: 'javascript' | 'python') {
  const fake = fakeEditor();
  renderHook(() => useBreakpointGutter(fake.editor, fake.monaco, { activeTabId: 't1', language, toggleAriaLabel: label }));
  return fake;
}

beforeEach(() => {
  useDebuggerStore.setState({ breakpoints: {}, breakpointOrder: [], pausedFrame: null, session: null });
  Object.defineProperty(window, 'lingua', { configurable: true, value: { platform: 'darwin' } });
});

describe('breakpoint gutter', () => {
  it('cycles a mark through its modes on alt-click in JavaScript', () => {
    const gutter = mount('javascript');
    gutter.click(3, true);
    expect(useDebuggerStore.getState().breakpoints['t1:3']?.mode).toBe('conditional');
    expect(gutter.latest()[0]?.options.glyphMarginClassName).toBe('lingua-bp-glyph lingua-bp-glyph--conditional');
    gutter.click(3, true);
    expect(useDebuggerStore.getState().breakpoints['t1:3']?.mode).toBe('logpoint');
    gutter.click(3, true);
    expect(useDebuggerStore.getState().breakpoints['t1:3']?.mode).toBe('pause');
    gutter.click(3);
    expect(useDebuggerStore.getState().breakpoints['t1:3']).toBeUndefined();
  });

  it('keeps alt-click a plain toggle where only pause breakpoints exist', () => {
    const gutter = mount('python');
    gutter.click(2, true);
    expect(useDebuggerStore.getState().breakpoints['t1:2']?.mode).toBe('pause');
    expect(gutter.latest()[0]?.options.glyphMarginHoverMessage).toEqual({ value: 'line 2 pause only' });
    gutter.click(2, true);
    expect(useDebuggerStore.getState().breakpoints['t1:2']).toBeUndefined();
  });

  it('draws a stored mode as a plain mark in a runtime without modes', () => {
    useDebuggerStore.getState().toggleBreakpoint('t1', 4);
    useDebuggerStore.getState().setBreakpointMode('t1', 4, 'logpoint');
    const gutter = mount('python');
    expect(gutter.latest()[0]?.options.glyphMarginClassName).toBe('lingua-bp-glyph lingua-bp-glyph--pause');
  });

  it('marks the paused line with the paused tint and arrow', () => {
    const gutter = mount('javascript');
    act(() =>
      useDebuggerStore.getState().setPausedFrame({ tabId: 't1', line: 5, reason: 'user-breakpoint', locals: {}, callStack: [], watchResults: {} })
    );
    const paused = gutter.latest().find((decoration) => decoration.options.className === 'lingua-debugger-paused-line');
    expect(paused?.options.linesDecorationsClassName).toBe('lingua-debugger-paused-line-marker');
  });
});
