import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as monacoTypes from 'monaco-editor';
import { InlineResultWidgets } from '@/components/Editor/InlineResultWidgets';

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
    getOffsetForColumn: vi.fn(() => {
      if (inSelectionTransaction) throw new Error('Monaco selection transaction is incomplete');
      return offset;
    }),
    getTopForLineNumber: (line: number) => (line - 1) * 20,
    getBottomForLineNumber: (line: number) => line * 20 + (wrapped ? 20 : 0),
    getLineHeightForPosition: () => 20,
    onDidScrollChange: subscribe('scroll'),
    onDidLayoutChange: subscribe('layout'),
    onDidChangeConfiguration: subscribe('configuration'),
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
