import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as monacoTypes from 'monaco-editor';
import { InlineResultWidgets } from '@/components/Editor/InlineResultWidgets';
import { useResultStore } from '@/stores/resultStore';
import { useEditorStore } from '@/stores/editorStore';
import { useLiveRunStore } from '@/stores/liveRunStore';

let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
let resize: (() => void) | undefined;
function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
}

function harness() {
  let offset = 100;
  let scrollLeft = 0;
  let wrapped = false;
  let visible = true;
  let lineCount = 2;
  let contentWidth = 714;
  let version = 1;
  let lines: Record<number, string> = {};
  let nextZone = 0;
  let inSelectionTransaction = false;
  let emitZoneEvents = false;
  const callbacks = new Map<string, () => void>();
  const zones = new Map<string, monacoTypes.editor.IViewZone>();
  const subscribe = (name: string) => (fn: () => void) => {
    callbacks.set(name, fn);
    return { dispose: () => callbacks.delete(name) };
  };
  type EditRange = { startLineNumber: number; endLineNumber: number; startColumn: number };
  let contentChanges: Array<{ range: EditRange; text: string }> = [];
  const model = {
    getLineCount: () => lineCount,
    getLineMaxColumn: () => 90,
    getLineContent: (line: number) => lines[line] ?? 'value',
    getValue: () => Array.from({ length: lineCount }, (_, index) => lines[index + 1] ?? 'value').join('\n'),
    getLinesContent: () => Array.from({ length: lineCount }, (_, index) => lines[index + 1] ?? 'value'),
    getLineFirstNonWhitespaceColumn: (line: number) => (lines[line]?.search(/\S/) ?? 0) + 1,
    getVersionId: () => version,
    getLanguageId: () => 'javascript',
  };
  const editor = {
    getModel: () => model,
    getVisibleRanges: () => (visible ? [{ startLineNumber: 1, endLineNumber: 2 }] : []),
    getLayoutInfo: () => ({
      width: 800,
      contentLeft: 60,
      contentWidth,
      minimap: { minimapWidth: 0 },
      verticalScrollbarWidth: 14,
    }),
    getScrollTop: () => 0,
    getScrollLeft: () => scrollLeft,
    getOffsetForColumn: vi.fn((line: number, column: number) => {
      if (inSelectionTransaction) throw new Error('Monaco selection transaction is incomplete');
      // A line's indentation is measured at its first non-blank column: 8 px a character.
      return column < 90 ? (column - 1) * 8 : offset;
    }),
    getTopForLineNumber: (line: number) => (line - 1) * 20,
    getBottomForLineNumber: (line: number) => line * 20 + (wrapped ? 20 : 0),
    getLineHeightForPosition: () => 20,
    onDidScrollChange: subscribe('scroll'),
    onDidLayoutChange: subscribe('layout'),
    onDidChangeConfiguration: subscribe('configuration'),
    onDidContentSizeChange: subscribe('contentSize'),
    onDidChangeModelContent: (fn: (event: { changes: typeof contentChanges }) => void) =>
      subscribe('content')(() => fn({ changes: contentChanges })),
    onDidChangeModel: subscribe('model'),
    addOverlayWidget: (widget: monacoTypes.editor.IOverlayWidget) =>
      document.body.append(widget.getDomNode()),
    removeOverlayWidget: (widget: monacoTypes.editor.IOverlayWidget) =>
      widget.getDomNode().remove(),
    changeViewZones: (fn: (accessor: monacoTypes.editor.IViewZoneChangeAccessor) => void) =>
      fn({
        addZone: (zone: monacoTypes.editor.IViewZone) => {
          const id = String(++nextZone);
          zones.set(id, zone);
          if (emitZoneEvents) {
            callbacks.get('layout')?.();
            callbacks.get('scroll')?.();
          }
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
    setContentWidth: (value: number) => {
      contentWidth = value;
    },
    setLines: (value: Record<number, string>) => {
      lines = value;
      version += 1;
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
    setLineCount: (value: number) => {
      lineCount = value;
    },
    insertLineAbove: () => {
      lineCount += 1;
      // Enter at column 1 inserts line 2, so Monaco leaves a zone after line 1.
      contentChanges = [{ range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1 }, text: '\n' }];
    },
    // Monaco shifts rows below an edit by the number of lines it adds or removes.
    editLines: (range: EditRange, text: string, delta: number) => {
      lineCount += delta;
      contentChanges = [{ range, text }];
      for (const zone of zones.values()) {
        if (zone.afterLineNumber > range.startLineNumber) zone.afterLineNumber += delta;
      }
    },
    dropZonesForModelSwap: () => {
      zones.clear();
    },
    fireSync: (name: string) =>
      act(() => {
        inSelectionTransaction = true;
        try {
          callbacks.get(name)?.();
        } finally {
          inSelectionTransaction = false;
        }
      }),
    emitZoneEvents: () => {
      emitZoneEvents = true;
    },
    fire: (name: string) => {
      act(() => callbacks.get(name)?.());
      flushFrames();
    },
    measure: editor.getOffsetForColumn,
    callbacks,
  };
}
const props = {
  monaco: {} as typeof monacoTypes,
  tabId: 'tab',
  lineResults: [{ line: 1, type: 'error' as const, value: 'Long error example' }],
};

beforeEach(() => {
  frames.clear();
  resize = undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
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
  vi.unstubAllGlobals();
  useLiveRunStore.setState({ byTab: {} });
});

describe('inline results line up in the answer column', () => {
  const tall = (height: number) =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const h = this.classList.contains('lingua-inline-result') ? height : 24;
      return { width: 180, height: h, top: 0, left: 0, right: 180, bottom: h, x: 0, y: 0, toJSON() {} };
    });

  it('places answers at the column start and draws a leader from the line text', () => {
    const h = harness();
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    const widget = document.querySelector<HTMLElement>('.lingua-inline-result')!;
    // A 300 px column ends 22 px inside the 714 px content area; the text ends at offset 100.
    expect(widget.style.left).toBe('452px');
    expect(widget.style.getPropertyValue('--answer-column-width')).toBe('300px');
    expect(widget.style.getPropertyValue('--answer-leader')).toBe('264px');
    expect(widget.hasAttribute('data-below')).toBe(false);
  });

  it('marks an answer that moves under its line, which hides its leader', () => {
    const h = harness();
    h.setOffset(700);
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.hasAttribute('data-below')).toBe(true);
  });

  it('spreads a tall answer over the free line below before reserving a row', () => {
    tall(70);
    const h = harness();
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    // 70 px need four 20 px lines; its own line and line 2 are free, so 30 px are reserved after line 2.
    expect([...h.zones.values()]).toMatchObject([{ afterLineNumber: 2, heightInPx: 30 }]);
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.style.top).toBe('0px');
  });

  it('counts unrendered lines below a tall answer as free, so scrolling does not move its row', () => {
    tall(70);
    const h = harness();
    h.setLineCount(6);
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    // Line 2 is rendered and free; lines 3 and 4 are past the viewport and count as free too.
    expect(h.zones.size).toBe(0);
  });

  it('does not spread a tall answer over a line that has its own answer', () => {
    tall(70);
    const h = harness();
    const lineResults = [
      { line: 1, type: 'result' as const, value: '[1]' },
      { line: 2, type: 'result' as const, value: '2' },
    ];
    render(<InlineResultWidgets {...props} lineResults={lineResults} editor={h.editor} />);
    flushFrames();
    expect([...h.zones.values()].map(zone => [zone.afterLineNumber, zone.heightInPx])).toEqual([
      [1, 50],
      [2, 50],
    ]);
  });
});

describe('inline results avoid source collisions', () => {
  it('keeps short source results inline without reserving a row', () => {
    const h = harness();
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect(h.zones.size).toBe(0);
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.style.top).toBe('0px');
  });
  it('reserves a row for long source, and returns inline after a horizontal scroll', () => {
    const h = harness();
    h.setOffset(700);
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
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
  it('moves a result to its own row when actions after the line text leave it no room', () => {
    const h = harness();
    const view = render(<InlineResultWidgets {...props} editor={h.editor} lineEndReserve={null} />);
    flushFrames();
    expect(h.zones.size).toBe(0);
    view.rerender(<InlineResultWidgets {...props} editor={h.editor} lineEndReserve={{ line: 1, width: 520 }} />);
    flushFrames();
    expect(h.zones.size).toBe(1);
    view.rerender(<InlineResultWidgets {...props} editor={h.editor} lineEndReserve={{ line: 2, width: 520 }} />);
    flushFrames();
    expect(h.zones.size).toBe(0);
  });

  it('keeps wrapped source clear even if its last visual segment is short', () => {
    const h = harness();
    h.setWrapped();
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect(h.zones.size).toBe(1);
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.style.top).toBe('40px');
    view.unmount();
    expect(h.zones.size).toBe(0);
  });
  it('preserves reserved height while a line is offscreen and cleans deleted lines', () => {
    const h = harness();
    h.setOffset(700);
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
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
    flushFrames();
    expect(h.zones.size).toBe(1);
  });
  it('defers and coalesces measurements until Monaco finishes synchronous content events', () => {
    const h = harness();
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    expect(h.measure).not.toHaveBeenCalled();
    flushFrames();
    h.measure.mockClear();
    h.setOffset(700);
    h.fireSync('content');
    h.fireSync('layout');
    h.fireSync('scroll');
    h.fireSync('configuration');
    act(() => resize?.());
    expect(h.measure).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    flushFrames();
    expect(h.measure).toHaveBeenCalledTimes(1);
    expect(h.zones.size).toBe(1);
  });
  it('cancels queued measurements when widgets unmount or switch editors', () => {
    const old = harness();
    const current = harness();
    const view = render(<InlineResultWidgets {...props} editor={old.editor} />);
    const staleEvent = old.callbacks.get('content')!;
    const staleResize = resize!;
    view.rerender(<InlineResultWidgets {...props} editor={current.editor} />);
    flushFrames();
    act(() => {
      staleEvent();
      staleResize();
    });
    expect(frames.size).toBe(0);
    expect(old.measure).not.toHaveBeenCalled();
    expect(current.measure).toHaveBeenCalledTimes(1);
    current.measure.mockClear();
    current.fireSync('content');
    const unmountedEvent = current.callbacks.get('content')!;
    const unmountedResize = resize!;
    view.unmount();
    act(() => {
      unmountedEvent();
      unmountedResize();
    });
    expect(frames.size).toBe(0);
    flushFrames();
    expect(current.measure).not.toHaveBeenCalled();
  });

  it('rejects a stale queued frame after same-editor result and tab replacement', () => {
    const h = harness();
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    const staleFrame = [...frames.values()][0]!;
    view.rerender(
      <InlineResultWidgets
        {...props}
        tabId="next"
        lineResults={[{ line: 2, type: 'error', value: 'Replacement' }]}
        editor={h.editor}
      />
    );
    act(() => staleFrame(0));
    expect(h.measure).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    flushFrames();
    expect(h.measure).toHaveBeenCalledExactlyOnceWith(2, 90);
  });
  it('keeps a reserved row through a run-start clear and reuses it for the same line', () => {
    const h = harness();
    h.setOffset(700);
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    const [zoneId] = [...h.zones.keys()];
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} running editor={h.editor} />);
    flushFrames();
    expect([...h.zones.keys()]).toEqual([zoneId]);
    view.rerender(
      <InlineResultWidgets
        {...props}
        lineResults={[{ line: 1, type: 'error', value: 'Next run' }]}
        editor={h.editor}
      />
    );
    flushFrames();
    expect([...h.zones.keys()]).toEqual([zoneId]);
    view.unmount();
    expect(h.zones.size).toBe(0);
  });

  it('releases rows the finished run did not reuse, and only once it finishes', () => {
    const h = harness();
    h.setOffset(700);
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} running editor={h.editor} />);
    h.setOffset(0);
    const partial = [{ line: 2, type: 'error' as const, value: 'Streamed' }];
    view.rerender(<InlineResultWidgets {...props} lineResults={partial} running editor={h.editor} />);
    flushFrames();
    expect(h.zones.size).toBe(1);
    view.rerender(<InlineResultWidgets {...props} lineResults={partial} editor={h.editor} />);
    expect(h.zones.size).toBe(0);
  });

  it('releases reserved rows when a run ends without results or results clear without a run', () => {
    const h = harness();
    h.setOffset(700);
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} running editor={h.editor} />);
    expect(h.zones.size).toBe(1);
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} editor={h.editor} />);
    expect(h.zones.size).toBe(0);

    view.rerender(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect(h.zones.size).toBe(1);
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} editor={h.editor} />);
    expect(h.zones.size).toBe(0);
  });

  it('keeps a retained row through line edits and hands it to the moved result', () => {
    const h = harness();
    h.setOffset(700);
    const onLine = (line: number) => [{ line, type: 'error' as const, value: 'Long error example' }];
    const view = render(<InlineResultWidgets {...props} lineResults={onLine(2)} editor={h.editor} />);
    flushFrames();
    const [zoneId] = [...h.zones.keys()];
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} running editor={h.editor} />);
    h.editLines({ startLineNumber: 1, endLineNumber: 1, startColumn: 15 }, '\n', 1);
    h.fire('content');
    expect([...h.zones.keys()]).toEqual([zoneId]);
    view.rerender(<InlineResultWidgets {...props} lineResults={onLine(3)} editor={h.editor} />);
    flushFrames();
    expect([...h.zones.keys()]).toEqual([zoneId]);

    view.rerender(<InlineResultWidgets {...props} lineResults={[]} running editor={h.editor} />);
    h.editLines({ startLineNumber: 1, endLineNumber: 2, startColumn: 15 }, '', -1);
    h.fire('content');
    view.rerender(<InlineResultWidgets {...props} lineResults={onLine(2)} editor={h.editor} />);
    flushFrames();
    expect([...h.zones.keys()]).toEqual([zoneId]);
    expect(h.zones.get(zoneId)).toMatchObject({ afterLineNumber: 2 });
  });

  it('does not hand a retained row dropped by a model swap to the next results', () => {
    const h = harness();
    h.setOffset(700);
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} running editor={h.editor} />);
    h.dropZonesForModelSwap();
    h.fire('model');
    view.rerender(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect(h.zones.size).toBe(1);
  });

  it('schedules no measurement while there are no widgets', () => {
    const h = harness();
    render(<InlineResultWidgets {...props} lineResults={[]} editor={h.editor} />);
    act(() => {
      h.callbacks.get('scroll')?.();
      h.callbacks.get('content')?.();
    });
    expect(frames.size).toBe(0);
  });

  it('moves a shown result and its row below a line inserted above its source', () => {
    const h = harness();
    h.setOffset(700);
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect([...h.zones.values()][0]).toMatchObject({ afterLineNumber: 1 });
    h.insertLineAbove();
    h.fire('content');
    expect(h.zones.size).toBe(1);
    expect([...h.zones.values()][0]).toMatchObject({ afterLineNumber: 2 });
    const widget = document.querySelector<HTMLElement>('.lingua-inline-result');
    expect(widget?.dataset.line).toBe('2');
    expect(widget?.style.top).toBe('40px');
  });

  it('keeps a shown result and its row with the source when a line opens above it', () => {
    const h = harness();
    h.setOffset(700);
    const onLine2 = [{ line: 2, type: 'error' as const, value: 'Long error example' }];
    render(<InlineResultWidgets {...props} lineResults={onLine2} editor={h.editor} />);
    flushFrames();
    const [zoneId] = [...h.zones.keys()];
    // Enter at the end of line 1: Monaco moves the row with the source.
    h.editLines({ startLineNumber: 1, endLineNumber: 1, startColumn: 15 }, '\n', 1);
    h.fire('content');
    expect([...h.zones.keys()]).toEqual([zoneId]);
    expect(h.zones.get(zoneId)).toMatchObject({ afterLineNumber: 3 });
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.dataset.line).toBe('3');
  });

  it('drops a shown result and its row when its source line is deleted', () => {
    const h = harness();
    h.setOffset(700);
    const onLine2 = [{ line: 2, type: 'error' as const, value: 'Long error example' }];
    render(<InlineResultWidgets {...props} lineResults={onLine2} editor={h.editor} />);
    flushFrames();
    h.editLines({ startLineNumber: 2, endLineNumber: 3, startColumn: 1 }, '', -1);
    h.fire('content');
    expect(h.zones.size).toBe(0);
    expect(document.querySelector('.lingua-inline-result')).toBeNull();
  });
  it('restores reserved rows after Monaco swaps the model and drops view zones', () => {
    const h = harness();
    h.setOffset(700);
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect(h.zones.size).toBe(1);
    h.dropZonesForModelSwap();
    h.fire('model');
    expect(h.zones.size).toBe(1);
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.style.top).toBe('20px');
  });
  it('does not schedule itself through view-zone layout and scroll notifications', () => {
    const h = harness();
    h.setOffset(700);
    h.emitZoneEvents();
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect(h.zones.size).toBe(1);
    expect(frames.size).toBe(0);
    expect(h.measure).toHaveBeenCalledTimes(1);
  });
});

describe('answers span their statement, fall back under narrow editors and never clip silently', () => {
  const tall = (height: number) =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const h = this.classList.contains('lingua-inline-result') ? height : 24;
      return { width: 180, height: h, top: 0, left: 0, right: 180, bottom: h, x: 0, y: 0, toJSON() {} };
    });

  it('moves a tall answer under its statement when a line inside reaches the column', () => {
    tall(70);
    const h = harness();
    h.setLineCount(5);
    h.setLines({ 1: 'console.table([', 2: '  { a: 1 },', 3: '  { a: 2 },', 4: '])', 5: 'next' });
    // Line 2 reaches the column; lines 1, 3 and 4 do not.
    const offsets: Record<number, number> = { 1: 100, 2: 700, 3: 100, 4: 100, 5: 100 };
    vi.mocked(h.measure).mockImplementation((line: number, column: number) => (column < 90 ? 0 : offsets[line]!));
    render(<InlineResultWidgets {...props} lineResults={[{ line: 1, type: 'log', value: 'table' }]} editor={h.editor} />);
    flushFrames();
    const widget = document.querySelector<HTMLElement>('.lingua-inline-result')!;
    expect(widget.hasAttribute('data-below')).toBe(true);
    expect([...h.zones.values()]).toMatchObject([{ afterLineNumber: 4, heightInPx: 76 }]);
    expect(widget.style.top).toBe('80px');
  });

  it('keeps an off-screen row under its statement when a line is added inside it', () => {
    tall(70);
    const h = harness();
    h.setLineCount(5);
    h.setLines({ 1: 'console.table([', 2: '  { a: 1 },', 3: '  { a: 2 },', 4: '])', 5: 'next' });
    const offsets: Record<number, number> = { 1: 100, 2: 700, 3: 100, 4: 100, 5: 100 };
    vi.mocked(h.measure).mockImplementation((line: number, column: number) => (column < 90 ? 0 : offsets[line]!));
    render(<InlineResultWidgets {...props} lineResults={[{ line: 1, type: 'log', value: 'table' }]} editor={h.editor} />);
    flushFrames();
    expect([...h.zones.values()]).toMatchObject([{ afterLineNumber: 4 }]);
    h.setVisible(false);
    h.editLines({ startLineNumber: 3, endLineNumber: 3, startColumn: 1 }, '\n', 1);
    h.fire('content');
    expect([...h.zones.values()]).toMatchObject([{ afterLineNumber: 5 }]);
  });

  it('keeps a tall answer beside its statement when every line leaves room', () => {
    tall(70);
    const h = harness();
    h.setLineCount(5);
    h.setLines({ 1: 'console.table([', 2: '  { a: 1 },', 3: '  { a: 2 },', 4: '])', 5: 'next' });
    render(<InlineResultWidgets {...props} lineResults={[{ line: 1, type: 'log', value: 'table' }]} editor={h.editor} />);
    flushFrames();
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.hasAttribute('data-below')).toBe(false);
    expect(h.zones.size).toBe(0);
  });

  it('puts every answer under its line at the code indent in a narrow editor', () => {
    const h = harness();
    h.setContentWidth(500);
    h.setLines({ 1: '    value', 2: 'value' });
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    const widget = document.querySelector<HTMLElement>('.lingua-inline-result')!;
    expect(widget.hasAttribute('data-narrow')).toBe(true);
    expect(widget.hasAttribute('data-below')).toBe(true);
    // Four spaces of 8 px after the 60 px gutter; the answer takes the rest of the width.
    expect(widget.style.left).toBe('92px');
    expect(widget.style.getPropertyValue('--answer-column-width')).toBe('446px');
  });

  it('marks an answer wider than its column', () => {
    const h = harness();
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('lingua-inline-result-body') ? 400 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('lingua-inline-result-body') ? 300 : 0;
    });
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.hasAttribute('data-clipped')).toBe(true);
  });

  it('marks an answer that was off-screen when its size was last checked', () => {
    const h = harness();
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('lingua-inline-result-body') ? 400 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('lingua-inline-result-body') ? 300 : 0;
    });
    h.setVisible(false);
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    h.setVisible(true);
    h.fire('scroll');
    expect(document.querySelector<HTMLElement>('.lingua-inline-result')?.hasAttribute('data-clipped')).toBe(true);
  });

  it('plays the answer motion only for a new or changed answer', () => {
    const h = harness();
    const view = render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    const entering = () => document.querySelector<HTMLElement>('.lingua-inline-result')?.hasAttribute('data-enter');
    expect(entering()).toBe(true);
    // A run clears its results, then publishes the same answer: nothing replays.
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} running editor={h.editor} />);
    view.rerender(<InlineResultWidgets {...props} lineResults={[...props.lineResults]} editor={h.editor} />);
    flushFrames();
    expect(entering()).toBe(false);
    view.rerender(<InlineResultWidgets {...props} lineResults={[{ line: 1, type: 'error', value: 'Changed' }]} editor={h.editor} />);
    flushFrames();
    expect(entering()).toBe(true);
  });

  it('labels the columns above the editor while it answers, and steps aside when narrow', () => {
    const h = harness();
    const slot = document.createElement('div');
    document.body.append(slot);
    const view = render(<InlineResultWidgets {...props} editor={h.editor} headerSlot={slot} />);
    flushFrames();
    const header = slot.querySelector<HTMLElement>('[data-testid="answer-column-header"]')!;
    expect(header.textContent).toContain('You write');
    expect(header.textContent).toContain('Lingua answers');
    // The answers label starts where the column does.
    expect(header.querySelector<HTMLElement>('.answer-column-header-answers')?.style.left).toBe('452px');
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} editor={h.editor} headerSlot={slot} />);
    expect(slot.querySelector('[data-testid="answer-column-header"]')).toBeNull();
    h.setContentWidth(500);
    view.rerender(<InlineResultWidgets {...props} editor={h.editor} headerSlot={slot} />);
    act(() => h.callbacks.get('layout')?.());
    expect(slot.querySelector('[data-testid="answer-column-header"]')).toBeNull();
    slot.remove();
  });
});

describe('changes since the previous run', () => {
  const initial = useResultStore.getState();
  afterEach(() => useResultStore.setState(initial, true));

  it('marks a changed answer and lets the header toggle the marks off', () => {
    const h = harness();
    const slot = document.createElement('div');
    document.body.append(slot);
    const lineResults = [{ line: 1, type: 'log' as const, value: '131' }];
    useResultStore.setState({
      tabAnswers: {
        tab: {
          previous: { number: 6, results: [{ line: 1, type: 'log', value: '118' }], sources: { 1: 'x' } },
          latest: { number: 7, results: lineResults, sources: { 1: 'x' } },
        },
      },
    });
    render(<InlineResultWidgets {...props} lineResults={lineResults} editor={h.editor} headerSlot={slot} />);
    flushFrames();
    expect(document.querySelector('[data-testid="answer-delta"]')?.textContent).toContain('118');
    const toggle = slot.querySelector<HTMLButtonElement>('[data-testid="answer-column-header-changes"]')!;
    expect(toggle.textContent).toContain('Changes since run 6');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-testid="answer-delta"]')).toBeNull();
    slot.remove();
  });

  it('keeps the header and its switch over the kept answers while the next run is in flight', () => {
    const h = harness();
    const slot = document.createElement('div');
    document.body.append(slot);
    const lineResults = [{ line: 1, type: 'log' as const, value: '131' }];
    useResultStore.setState({
      tabAnswers: {
        tab: {
          previous: { number: 6, results: [{ line: 1, type: 'log', value: '118' }], sources: { 1: 'value' } },
          latest: { number: 7, results: lineResults, sources: { 1: 'value' } },
        },
      },
      ranCode: { tabId: 'tab', code: 'value', input: '', at: 0 },
    });
    const view = render(<InlineResultWidgets {...props} lineResults={lineResults} editor={h.editor} headerSlot={slot} />);
    flushFrames();
    view.rerender(
      <InlineResultWidgets
        {...props}
        lineResults={[]}
        running
        keptRun={7}
        editor={h.editor}
        headerSlot={slot}
      />
    );
    flushFrames();
    expect(slot.querySelector('[data-testid="answer-column-header"]')).not.toBeNull();
    expect(slot.querySelector('[data-testid="answer-column-header-changes"]')?.textContent).toContain('Changes since run 6');
    expect(document.querySelector('[data-testid="lingua-inline-result"][data-kept]')).not.toBeNull();
    slot.remove();
  });

  it('keeps only the switch over a narrow editor', () => {
    const h = harness();
    h.setContentWidth(500);
    const slot = document.createElement('div');
    document.body.append(slot);
    const lineResults = [{ line: 1, type: 'log' as const, value: '2' }];
    useResultStore.setState({
      tabAnswers: {
        tab: {
          previous: { number: 1, results: [{ line: 1, type: 'log', value: '1' }], sources: {} },
          latest: { number: 2, results: lineResults, sources: {} },
        },
      },
    });
    render(<InlineResultWidgets {...props} lineResults={lineResults} editor={h.editor} headerSlot={slot} />);
    flushFrames();
    expect(slot.querySelector('[data-testid="answer-column-header-changes"]')).not.toBeNull();
    expect(slot.textContent).not.toContain('Lingua answers');
    slot.remove();
  });

  it('drops a closed tab\'s answers once the overlay is loaded', () => {
    const h = harness();
    useEditorStore.setState({ tabs: [{ id: 'tab' }, { id: 'gone' }] as never });
    const answers = { latest: { number: 1, results: [], sources: {} } };
    useResultStore.setState({ tabAnswers: { tab: answers, gone: answers } });
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    act(() => useEditorStore.setState({ tabs: [{ id: 'tab' }] as never }));
    expect(Object.keys(useResultStore.getState().tabAnswers)).toEqual(['tab']);
  });

  it('marks nothing when the answers on screen are not the latest run', () => {
    const h = harness();
    useResultStore.setState({
      tabAnswers: {
        tab: {
          previous: { number: 1, results: [{ line: 1, type: 'log', value: '1' }], sources: {} },
          latest: { number: 2, results: [{ line: 1, type: 'log', value: '2' }], sources: {} },
        },
      },
    });
    const slot = document.createElement('div');
    document.body.append(slot);
    render(<InlineResultWidgets {...props} lineResults={[{ line: 1, type: 'log', value: '3' }]} editor={h.editor} headerSlot={slot} />);
    flushFrames();
    expect(document.querySelector('[data-testid="answer-delta"]')).toBeNull();
    expect(slot.querySelector('[data-testid="answer-column-header-changes"]')).toBeNull();
    slot.remove();
  });
});

describe('a short answer under its line', () => {
  it('stays under its own line inside a multi-line statement', () => {
    const h = harness();
    h.setLineCount(4);
    h.setLines({ 1: 'items.forEach(item => {', 2: '  use(item)', 3: '})', 4: 'next' });
    h.setOffset(700);
    render(<InlineResultWidgets {...props} editor={h.editor} />);
    flushFrames();
    expect([...h.zones.values()]).toMatchObject([{ afterLineNumber: 1 }]);
  });
});

describe('the previous run holds its answers while the next run is in flight', () => {
  const previous = [
    { line: 1, type: 'autoLog' as const, value: '1' },
    { line: 2, type: 'autoLog' as const, value: '2' },
  ];
  const row = (line: number) => document.querySelector<HTMLElement>(`[data-testid="lingua-inline-result"][data-line="${line}"]`);
  const initial = useResultStore.getState();
  afterEach(() => useResultStore.setState(initial, true));

  function holding() {
    useResultStore.setState({ ranCode: { tabId: 'tab', code: 'a = 1\nb = 2\nprint(b)', input: '', at: 0 } });
    const h = harness();
    h.setLineCount(3);
    h.setLines({ 1: 'a = 1', 2: 'b = 2', 3: 'print(b)' });
    const view = render(<InlineResultWidgets {...props} lineResults={previous} editor={h.editor} />);
    flushFrames();
    const hold = () => {
      view.rerender(<InlineResultWidgets {...props} lineResults={[]} running keptRun={3} editor={h.editor} />);
      flushFrames();
    };
    return { h, view, hold };
  }

  it('keeps every answer, dimmed, and names its run once, until this run reaches the line', () => {
    const { hold } = holding();
    const first = row(1);
    hold();
    expect(row(1)).toBe(first);
    for (const line of [1, 2]) {
      expect(row(line)?.hasAttribute('data-kept')).toBe(true);
      expect(row(line)?.hasAttribute('data-enter')).toBe(false);
    }
    expect(document.querySelectorAll('[data-testid="lingua-inline-result-kept"]')).toHaveLength(1);
    expect(row(1)?.querySelector('[data-testid="lingua-inline-result-kept"]')?.textContent).toBe('from run 3 · not reached yet');
    expect(document.querySelector('[data-testid="answer-delta"]')).toBeNull();
  });

  it('replaces a kept answer when its line answers and drops the rest when the run settles', () => {
    const { h, view, hold } = holding();
    hold();
    const streamed = [{ line: 1, type: 'autoLog' as const, value: '10' }];
    view.rerender(<InlineResultWidgets {...props} lineResults={streamed} running keptRun={3} editor={h.editor} />);
    flushFrames();
    expect(row(1)?.hasAttribute('data-kept')).toBe(false);
    expect(row(1)?.textContent).toContain('10');
    expect(row(2)?.hasAttribute('data-kept')).toBe(true);
    expect(row(2)?.querySelector('[data-testid="lingua-inline-result-kept"]')).not.toBeNull();
    view.rerender(<InlineResultWidgets {...props} lineResults={streamed} editor={h.editor} />);
    flushFrames();
    expect(row(1)).not.toBeNull();
    expect(row(2)).toBeNull();
  });

  it('never keeps an answer this run streamed when a later publish leaves its line out', () => {
    const { h, view, hold } = holding();
    hold();
    const streamed = [{ line: 3, type: 'log' as const, value: '2' }];
    view.rerender(<InlineResultWidgets {...props} lineResults={streamed} running keptRun={3} editor={h.editor} />);
    flushFrames();
    view.rerender(<InlineResultWidgets {...props} lineResults={[previous[0]!]} running keptRun={3} editor={h.editor} />);
    flushFrames();
    expect(row(3)).toBeNull();
    expect(row(2)?.hasAttribute('data-kept')).toBe(true);
  });

  it('moves a kept answer with its code and drops one whose line changed before the run', () => {
    const { h, hold } = holding();
    // A line opens above both answers, then line 3 (was 2) changes.
    h.setLineCount(4);
    h.setLines({ 1: '', 2: 'a = 1', 3: 'b = 2', 4: 'print(b)' });
    h.editLines({ startLineNumber: 1, endLineNumber: 1, startColumn: 1 }, '\n', 1);
    h.fire('content');
    h.setLines({ 1: '', 2: 'a = 1', 3: 'b = 20', 4: 'print(b)' });
    hold();
    expect(row(2)?.hasAttribute('data-kept')).toBe(true);
    expect(row(2)?.textContent).toContain('1');
    expect(row(1)).toBeNull();
    expect(row(3)).toBeNull();
  });

  it('compares with the code the run executed, not the text the line held when its answer appeared', () => {
    useResultStore.setState({ ranCode: { tabId: 'tab', code: 'a = 1\nb = 2\nprint(b)', input: '', at: 0 } });
    const h = harness();
    h.setLineCount(3);
    // Line 1 was edited while that run was in flight.
    h.setLines({ 1: 'a = 10', 2: 'b = 2', 3: 'print(b)' });
    const view = render(<InlineResultWidgets {...props} lineResults={previous} editor={h.editor} />);
    flushFrames();
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} running keptRun={3} editor={h.editor} />);
    flushFrames();
    expect(row(1)).toBeNull();
    expect(row(2)?.hasAttribute('data-kept')).toBe(true);
  });

  it('drops a kept answer as soon as its line is edited during the run', () => {
    const { h, hold } = holding();
    hold();
    h.setLines({ 1: 'a = 10', 2: 'b = 2', 3: 'print(b)' });
    h.editLines({ startLineNumber: 1, endLineNumber: 1, startColumn: 6 }, '0', 0);
    h.fire('content');
    expect(row(1)).toBeNull();
    expect(row(2)?.hasAttribute('data-kept')).toBe(true);
  });

  it('keeps nothing without a held run, as for a debug run', () => {
    const { h, view } = holding();
    view.rerender(<InlineResultWidgets {...props} lineResults={[]} running editor={h.editor} />);
    flushFrames();
    expect(row(1)).toBeNull();
    expect(row(2)).toBeNull();
  });
});

describe('live answers while a run goes', () => {
  type Loop = { line: number; end?: number; pass: number; total?: number; binding?: { name: string; value: string } };
  const live = (code: string[], line: number, lineMs: number, loops: Loop[] = []) =>
    act(() => useLiveRunStore.getState().publish('tab', 'run-1', { line, lineMs, elapsedMs: lineMs, loops }, code.join('\n')));
  const liveAnswer = (line: number) => document.querySelector<HTMLElement>(`[data-testid="lingua-live-answer"][data-line="${line}"]`);

  it('names the loop pass and variable on the header and RUNNING on the line that holds the run, over its own answer', () => {
    const h = harness();
    const code = ['for (const name of names) {', '  slow(name);'];
    h.setLines({ 1: code[0]!, 2: code[1]! });
    render(<InlineResultWidgets {...props} lineResults={[{ line: 2, type: 'result', value: '7' }]} language="javascript" editor={h.editor} />);
    live(code, 2, 40, [{ line: 1, pass: 3, total: 3, binding: { name: 'name', value: '"db"' } }]);
    flushFrames();
    const loop = liveAnswer(1)!;
    expect(loop.textContent).toContain('loop');
    expect(loop.textContent).toContain('3 of 3');
    expect(loop.textContent).toContain('name =');
    expect(loop.textContent).toContain('"db"');
    expect(loop.style.left).toBe('452px');
    expect(loop.style.visibility).toBe('');
    // Under the hold time a line is passing through, not holding the run.
    expect(liveAnswer(2)).toBeNull();
    live(code, 2, 320, [{ line: 1, pass: 3, total: 3 }]);
    flushFrames();
    const running = liveAnswer(2)!;
    expect(running.textContent).toContain('running');
    expect(running.textContent).toContain('on this line');
    expect(running.querySelector('[data-live-kind="running"]')).not.toBeNull();
    const own = document.querySelector<HTMLElement>('[data-testid="lingua-inline-result"][data-line="2"]')!;
    expect(own.hasAttribute('data-live-covered')).toBe(true);
    act(() => useLiveRunStore.getState().clear('tab', 'run-1'));
    flushFrames();
    expect(liveAnswer(1)).toBeNull();
    expect(own.hasAttribute('data-live-covered')).toBe(false);
  });

  it('counts a repeated answer as passes of the open loop around it', () => {
    const h = harness();
    h.setLineCount(3);
    const code = ['for (const n of [1, 2, 3]) {', '  console.log(n);', '}'];
    h.setLines({ 1: code[0]!, 2: code[1]!, 3: code[2]! });
    const printed = [1, 2].map(pass => ({ line: 2, type: 'log' as const, value: String(pass), pass }));
    render(<InlineResultWidgets {...props} lineResults={printed} language="javascript" editor={h.editor} />);
    flushFrames();
    expect(document.querySelector('[data-testid="lingua-inline-result-repeat"]')?.textContent).toBe('last of 2');
    live(code, 2, 0, [{ line: 1, end: 3, pass: 2, total: 3 }]);
    expect(document.querySelector('[data-testid="lingua-inline-result-repeat"]')?.textContent).toBe('2 of 3 printed');
  });

  it('shows no live answer in a narrow editor or on a line edited since the run started', () => {
    const h = harness();
    const code = ['for (const n of xs) {', '  slow(n);'];
    h.setLines({ 1: code[0]!, 2: code[1]! });
    render(<InlineResultWidgets {...props} lineResults={[]} language="javascript" editor={h.editor} />);
    live(code, 2, 400, [{ line: 1, pass: 1, total: 2 }]);
    flushFrames();
    expect(liveAnswer(2)?.style.visibility).toBe('');
    h.setLines({ 1: 'for (const n of xs) {', 2: '  slower(n);' });
    h.fire('content');
    expect(liveAnswer(2)?.style.visibility).toBe('hidden');
    expect(liveAnswer(1)?.style.visibility).toBe('');
    h.setContentWidth(500);
    h.fire('layout');
    expect(liveAnswer(1)?.style.visibility).toBe('hidden');
  });
});

