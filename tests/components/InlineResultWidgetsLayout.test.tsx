import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as monacoTypes from 'monaco-editor';
import { InlineResultWidgets } from '@/components/Editor/InlineResultWidgets';

function harness() {
  let offset = 100;
  let scrollLeft = 0;
  let wrapped = false;
  let visible = true;
  let lineCount = 2;
  let nextZone = 0;
  const callbacks = new Map<string, () => void>();
  const zones = new Map<string, monacoTypes.editor.IViewZone>();
  const subscribe = (name: string) => (fn: () => void) => {
    callbacks.set(name, fn);
    return { dispose: () => callbacks.delete(name) };
  };
  const model = {
    getLineCount: () => lineCount,
    getLineMaxColumn: () => 90,
    onDidChangeContent: subscribe('content'),
  };
  const editor = {
    getModel: () => model,
    getVisibleRanges: () => (visible ? [{ startLineNumber: 1, endLineNumber: 2 }] : []),
    getLayoutInfo: () => ({
      width: 800,
      contentLeft: 60,
      contentWidth: 714,
      minimap: { minimapWidth: 0 },
      verticalScrollbarWidth: 14,
    }),
    getScrollTop: () => 0,
    getScrollLeft: () => scrollLeft,
    getOffsetForColumn: () => offset,
    getTopForLineNumber: (line: number) => (line - 1) * 20,
    getBottomForLineNumber: (line: number) => line * 20 + (wrapped ? 20 : 0),
    getLineHeightForPosition: () => 20,
    onDidScrollChange: subscribe('scroll'),
    onDidLayoutChange: subscribe('layout'),
    onDidChangeConfiguration: subscribe('configuration'),
    addOverlayWidget: (widget: monacoTypes.editor.IOverlayWidget) =>
      document.body.append(widget.getDomNode()),
    removeOverlayWidget: (widget: monacoTypes.editor.IOverlayWidget) =>
      widget.getDomNode().remove(),
    changeViewZones: (fn: (accessor: monacoTypes.editor.IViewZoneChangeAccessor) => void) =>
      fn({
        addZone: (zone: monacoTypes.editor.IViewZone) => {
          const id = String(++nextZone);
          zones.set(id, zone);
          return id;
        },
        removeZone: (id: string) => {
          zones.delete(id);
        },
        layoutZone: vi.fn(),
      }),
  };
  return {
    editor: editor as unknown as monacoTypes.editor.IStandaloneCodeEditor,
    zones,
    setOffset: (value: number) => {
      offset = value;
    },
    setScrollLeft: (value: number) => {
      scrollLeft = value;
    },
    setWrapped: () => {
      wrapped = true;
    },
    setVisible: (value: boolean) => {
      visible = value;
    },
    removeLine: () => {
      lineCount = 0;
    },
    fire: (name: string) => act(() => callbacks.get(name)?.()),
    callbacks,
  };
}
const props = {
  monaco: {} as typeof monacoTypes,
  tabId: 'tab',
  lineResults: [{ line: 1, type: 'error' as const, value: 'Long error example' }],
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    return {
      width: 180,
      height: 24,
      top: 0,
      left: 0,
      right: 180,
      bottom: 24,
      x: 0,
      y: 0,
      toJSON() {},
    };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('inline results avoid source collisions', () => {
  it('keeps short source results inline without reserving a row', () => {
    const h = harness();
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    expect(h.zones.size).toBe(0);
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.style.top).toBe('0px');
  });
  it('reserves a row for long source, and returns inline after a horizontal scroll', () => {
    const h = harness();
    h.setOffset(700);
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    expect(h.zones.size).toBe(1);
    expect([...h.zones.values()][0]).toMatchObject({ afterLineNumber: 1, heightInPx: 30 });
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.style.top).toBe('20px');
    h.fire('layout');
    expect(h.zones.size).toBe(1);
    h.setScrollLeft(400);
    h.fire('scroll');
    expect(h.zones.size).toBe(0);
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.style.top).toBe('0px');
    view.unmount();
    expect(h.callbacks.size).toBe(0);
  });
  it('keeps wrapped source clear even if its last visual segment is short', () => {
    const h = harness();
    h.setWrapped();
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    expect(h.zones.size).toBe(1);
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.style.top).toBe('40px');
    view.unmount();
    expect(h.zones.size).toBe(0);
  });
  it('preserves reserved height while a line is offscreen and cleans deleted lines', () => {
    const h = harness();
    h.setOffset(700);
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    expect(h.zones.size).toBe(1);
    h.setVisible(false);
    h.setOffset(0);
    h.fire('scroll');
    expect(h.zones.size).toBe(1);
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.style.visibility).toBe(
      'hidden'
    );
    h.setVisible(true);
    h.fire('scroll');
    expect(h.zones.size).toBe(0);
    h.setOffset(700);
    h.fire('content');
    expect(h.zones.size).toBe(1);
    h.removeLine();
    h.fire('content');
    expect(h.zones.size).toBe(0);
  });
  it('reserves a row when Monaco cannot measure the visible line end', () => {
    const h = harness();
    h.setOffset(-1);
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    expect(h.zones.size).toBe(1);
  });
});
