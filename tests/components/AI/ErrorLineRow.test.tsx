import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import type * as monacoTypes from 'monaco-editor';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { ErrorLineRow } from '../../../src/renderer/components/AI/ErrorLineRow';
import { describeError } from '../../../src/renderer/utils/describeError';
import { useDebuggerStore } from '../../../src/renderer/stores/debuggerStore';
import { useExplainPanelStore } from '../../../src/renderer/stores/explainPanelStore';
import { useResultStore } from '../../../src/renderer/stores/resultStore';

let entitled = true;
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({ useEntitlement: () => entitled }));

const layoutWidth = { current: 1600 };

function fakeEditor() {
  const zones: { afterLineNumber: number }[] = [];
  const widgets: monacoTypes.editor.IContentWidget[] = [];
  const editor = {
    getModel: () => ({ getLineCount: () => 10, getLineMaxColumn: () => 30 }),
    changeViewZones: (callback: (accessor: { addZone: (zone: { afterLineNumber: number }) => string; removeZone: () => void }) => void) =>
      callback({ addZone: (zone) => String(zones.push(zone)), removeZone: () => zones.pop() }),
    createDecorationsCollection: () => ({ getRange: () => ({ startLineNumber: 2 }), clear: vi.fn() }),
    addContentWidget: (widget: monacoTypes.editor.IContentWidget) => {
      widgets.push(widget);
      document.body.appendChild(widget.getDomNode());
    },
    removeContentWidget: (widget: monacoTypes.editor.IContentWidget) => widget.getDomNode().remove(),
    onDidChangeModelContent: () => ({ dispose: vi.fn() }),
    onDidLayoutChange: () => ({ dispose: vi.fn() }),
    onDidScrollChange: () => ({ dispose: vi.fn() }),
    getLayoutInfo: () => ({ width: layoutWidth.current, contentLeft: 60, verticalScrollbarWidth: 14, minimap: { minimapWidth: 0 } }),
    getOffsetForColumn: () => 300,
    getScrollLeft: () => 0,
    layoutContentWidget: vi.fn(),
  };
  const monaco = { Range: class {}, editor: { ContentWidgetPositionPreference: { EXACT: 0 } } };
  return { editor: editor as unknown as monacoTypes.editor.IStandaloneCodeEditor, monaco: monaco as unknown as typeof monacoTypes, zones, widgets };
}

beforeAll(async () => {
  await initI18n('en');
  await i18next.changeLanguage('en');
});

beforeEach(() => {
  entitled = true;
  useDebuggerStore.setState({ breakpoints: {}, breakpointOrder: [] });
  useExplainPanelStore.setState({ target: null, pinned: false, threads: {} });
  useResultStore.setState({
    error: { message: "Cannot read properties of null (reading 'name')", line: 2, column: 43, stack: "TypeError: Cannot read properties of null (reading 'name')\n    at eval (user code:2:43)" },
  });
});

describe('error line row', () => {
  it('reads the error name from the message or the first stack line', () => {
    expect(describeError({ message: 'NameError: x is not defined' })).toEqual({ name: 'NameError', text: 'x is not defined', full: 'NameError: x is not defined' });
    expect(describeError({ message: 'boom', stack: 'RangeError: boom\n at a' }).full).toBe('RangeError: boom');
    expect(describeError({ message: 'boom' })).toEqual({ name: null, text: 'boom', full: 'boom' });
  });

  it('sits at the end of the failing line, without a reserved row, and offers its actions', () => {
    const fake = fakeEditor();
    render(<ErrorLineRow editor={fake.editor} monaco={fake.monaco} tabId="t1" language="javascript" />);
    expect(fake.zones).toHaveLength(0);
    expect(fake.widgets[0]?.getPosition()).toEqual({ position: { lineNumber: 2, column: 30 }, preference: [0] });
    expect(screen.getByTestId('error-line-row').textContent).toBe('TypeErrorcol 43ExplainCopy stackAdd breakpoint');
    fireEvent.click(screen.getByTestId('error-line-explain'));
    expect(useExplainPanelStore.getState().target).toEqual({
      tabId: 't1',
      errorMessage: "TypeError: Cannot read properties of null (reading 'name')",
      line: 2,
      column: 43,
    });
    fireEvent.click(screen.getByTestId('error-line-breakpoint'));
    expect(useDebuggerStore.getState().breakpoints['t1:2']).toBeTruthy();
    expect(screen.queryByTestId('error-line-breakpoint')).toBeNull();
  });

  it('drops the labels for icons when the actions would pass the editor edge', async () => {
    let measure: (() => void) | null = null;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        measure = callback;
      }
      observe() {
        measure?.();
      }
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect);
    layoutWidth.current = 700;
    const fake = fakeEditor();
    render(<ErrorLineRow editor={fake.editor} monaco={fake.monaco} tabId="t1" language="javascript" onWidthChange={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('error-line-copy').textContent).toBe(''));
    expect(screen.getByTestId('error-line-copy').getAttribute('aria-label')).toBe('Copy stack');
    layoutWidth.current = 1600;
    vi.unstubAllGlobals();
  });

  it('hides Explain without the AI entitlement and Add breakpoint without a debugger', () => {
    entitled = false;
    const fake = fakeEditor();
    render(<ErrorLineRow editor={fake.editor} monaco={fake.monaco} tabId="t1" language="ruby" />);
    expect(screen.queryByTestId('error-line-explain')).toBeNull();
    expect(screen.queryByTestId('error-line-breakpoint')).toBeNull();
    expect(screen.getByTestId('error-line-copy')).toBeTruthy();
  });
});
