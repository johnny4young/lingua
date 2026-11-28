import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PulseRailHost } from '@/components/Editor/PulseRailHost';
import { useDebuggerStore } from '@/stores/debuggerStore';
import { useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { useLiveRunStore } from '@/stores/liveRunStore';
import { useResultStore } from '@/stores/resultStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useUIStore } from '@/stores/uiStore';

const source = ['const a = 1;', 'const b = 2;', '', 'console.log(a + b);', 'const c = 3;'];

type Decoration = { range: { line: number }; options: Record<string, string> };

class FakeModel {
  collections = new Map<object, Decoration[]>();
  constructor(public lines: string[]) {}
  getLinesContent = () => this.lines;
  get decorations(): Decoration[] {
    return [...this.collections.values()].flat();
  }
  private classes = (held: boolean) =>
    this.decorations.filter(({ options }) => (options.linesDecorationsClassName === 'lingua-rail-hold') === held);
  /** The rail class of each decorated line. */
  rail = () => Object.fromEntries(this.classes(false).map(({ range, options }) => [range.line, options.linesDecorationsClassName]));
  /** Lines holding the paused ring. */
  held = () => this.classes(true).map(({ range }) => range.line);
}

/** Like Monaco, a collection writes to the current model and a detached model loses the editor's marks. */
function fakeEditor(model: FakeModel) {
  let current = model;
  const listeners: Array<() => void> = [];
  return {
    getModel: () => current,
    onDidChangeModel: (listener: () => void) => {
      listeners.push(listener);
      return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
    },
    createDecorationsCollection: (initial: Decoration[]) => {
      const key = {};
      current.collections.set(key, initial);
      return {
        set: (next: Decoration[]) => {
          current.collections.set(key, next);
        },
        clear: () => {
          current.collections.delete(key);
        },
      };
    },
    swap(next: FakeModel) {
      current.collections.clear();
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

const monaco = {
  Range: class {
    constructor(public line: number) {}
  },
  editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
};

function publishRun(lines: number[], extra: Partial<ReturnType<typeof useResultStore.getState>> = {}) {
  act(() =>
    useResultStore.setState({
      lineResults: lines.map(line => ({ line, value: String(line), type: 'result' as const })),
      lineTimings: [],
      error: null,
      ranCode: { tabId: 't1', code: source.join('\n'), input: '', at: 0 },
      isAutoRunning: false,
      isManualRunning: false,
      runTermination: { kind: 'success' },
      ...extra,
    })
  );
}

beforeEach(() => {
  useExecutionHistoryStore.setState({ entries: [] });
});

afterEach(() => {
  vi.useRealTimers();
  useResultStore.setState({ lineResults: [], lineTimings: [], error: null, ranCode: null, runTermination: null });
  useTimelineStore.setState({ recording: null, current: 0 });
  useDebuggerStore.setState({ pausedFrame: null });
  useUIStore.setState({ activeBottomPanel: 'console' });
  useLiveRunStore.setState({ byTab: {} });
});

describe('PulseRailHost', () => {
  it('ticks the lines that answered and lights the rest of a finished run', () => {
    const model = new FakeModel(source);
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t1" />);
    expect(model.rail()).toEqual({});
    publishRun([4]);
    expect(model.rail()).toEqual({
      1: 'lingua-rail lingua-rail--reached',
      2: 'lingua-rail lingua-rail--reached',
      3: 'lingua-rail lingua-rail--reached',
      4: 'lingua-rail lingua-rail--answered',
      5: 'lingua-rail lingua-rail--reached',
    });
  });

  it('marks only the region a region run was given, from its first published results', () => {
    const model = new FakeModel(source);
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t1" />);
    publishRun([4], { ranCode: { tabId: 't1', code: source.join('\n'), input: '', at: 0, span: { start: 3, end: 4 } } });
    expect(model.rail()).toEqual({
      3: 'lingua-rail lingua-rail--reached',
      4: 'lingua-rail lingua-rail--answered',
    });
  });

  it('crosses the line that threw and dots the code below it', () => {
    const model = new FakeModel(source);
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t1" />);
    publishRun([1], { error: { message: 'boom', line: 2 }, runTermination: { kind: 'error' } });
    expect(model.rail()).toMatchObject({
      1: 'lingua-rail lingua-rail--answered',
      2: 'lingua-rail lingua-rail--raised',
      4: 'lingua-rail lingua-rail--not-run',
    });
  });

  it('keeps the previous run\'s marks while the next run has not answered', () => {
    const model = new FakeModel(source);
    const editor = fakeEditor(model);
    const view = render(<PulseRailHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
    publishRun([4]);
    const settled = model.rail();
    view.rerender(<PulseRailHost editor={editor as never} monaco={monaco as never} tabId="t1" held />);
    publishRun([], { isAutoRunning: true, runTermination: null });
    expect(model.rail()).toEqual(settled);
    publishRun([1]);
    view.rerender(<PulseRailHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
    expect(model.rail()[1]).toBe('lingua-rail lingua-rail--answered');
  });

  it('beats on the line a run in flight is on, over the previous run\'s held marks', () => {
    const model = new FakeModel(source);
    const editor = fakeEditor(model);
    const view = render(<PulseRailHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
    publishRun([4]);
    view.rerender(<PulseRailHost editor={editor as never} monaco={monaco as never} tabId="t1" held />);
    publishRun([], { isManualRunning: true, runTermination: null });
    const beats = () =>
      model.decorations.filter(({ options }) => options.linesDecorationsClassName === 'lingua-rail lingua-rail--running').map(({ range }) => range.line);
    expect(beats()).toEqual([]);
    act(() => useLiveRunStore.getState().publish('t1', 'r1', { line: 2, lineMs: 0, elapsedMs: 5, loops: [] }));
    expect(beats()).toEqual([2]);
    expect(model.decorations.find(({ options }) => options.linesDecorationsClassName === 'lingua-rail lingua-rail--running')?.options).toMatchObject({
      lineNumberClassName: 'lingua-rail-number--running',
    });
    act(() => useLiveRunStore.getState().publish('t2', 'r2', { line: 5, lineMs: 0, elapsedMs: 5, loops: [] }));
    act(() => useLiveRunStore.getState().publish('t1', 'r1', { line: 4, lineMs: 0, elapsedMs: 60, loops: [] }));
    expect(beats()).toEqual([4]);
    act(() => useLiveRunStore.getState().clear('t1', 'r1'));
    expect(beats()).toEqual([]);
  });

  it('ignores results another tab produced', () => {
    const model = new FakeModel(source);
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t2" />);
    publishRun([4]);
    expect(model.rail()).toEqual({});
  });

  it('beats on the selected timeline step, fades the rail above it and marks its line', () => {
    const model = new FakeModel(source);
    useTimelineStore.setState({
      recording: {
        tabId: 't1',
        steps: [1, 2, 4, 5].map(line => ({ line, frames: [], vars: [] })),
        total: 4,
        truncated: false,
        limited: false,
      },
      current: 2,
    });
    useUIStore.setState({ consoleVisible: true, activeBottomPanel: 'timeline' });
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t1" />);
    expect(model.rail()).toMatchObject({
      1: 'lingua-rail lingua-rail--answered lingua-rail--trail lingua-rail--slot-0',
      2: 'lingua-rail lingua-rail--answered lingua-rail--trail lingua-rail--slot-4',
      4: 'lingua-rail lingua-rail--running',
      5: 'lingua-rail lingua-rail--not-run',
    });
    const live = model.decorations.find(d => d.range.line === 4)!;
    expect(live.options.lineNumberClassName).toBe('lingua-rail-number--running');
    expect(live.options.marginClassName).toBe('lingua-rail-band');
  });

  it('fades only the rail above the selected step, not the lines that ran below it', () => {
    const model = new FakeModel(source);
    useTimelineStore.setState({
      recording: {
        tabId: 't1',
        steps: [4, 5, 2].map(line => ({ line, frames: [], vars: [] })),
        total: 3,
        truncated: false,
        limited: false,
      },
      current: 2,
    });
    useUIStore.setState({ consoleVisible: true, activeBottomPanel: 'timeline' });
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t1" />);
    expect(model.rail()).toMatchObject({
      2: 'lingua-rail lingua-rail--running',
      4: 'lingua-rail lingua-rail--answered',
      5: 'lingua-rail lingua-rail--answered',
    });
  });

  it('holds the line the debugger paused on', () => {
    const model = new FakeModel(source);
    publishRun([]);
    act(() => useDebuggerStore.setState({ pausedFrame: { tabId: 't1', line: 2 } as never }));
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t1" />);
    expect(model.rail()[2]).toBe('lingua-rail lingua-rail--paused');
    expect(model.held()).toEqual([2]);
  });

  it('dots the functions a JS pause never reached, even below a line that answered', () => {
    const code = [
      'function sort(arr) {',
      '  const pivot = arr[0];',
      '  return arr;',
      '}',
      '',
      'function unused(arr) {',
      '  return arr.length;',
      '}',
      '',
      'console.log(sort([1]));',
      'console.log(unused([1]));',
    ];
    const model = new FakeModel(code);
    // A logpoint on line 11 answered, which used to light everything above it.
    publishRun([11], { isManualRunning: true, runTermination: null });
    act(() =>
      useDebuggerStore.setState({ pausedFrame: { tabId: 't1', line: 3, reachedLines: [2, 10] } as never })
    );
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t1" />);
    const state = (line: number) => model.rail()[line]?.match(/lingua-rail--([a-z-]+)/)?.[1];
    expect([1, 2, 3].map(state)).toEqual(['reached', 'answered', 'paused']);
    expect([6, 7, 8].map(state)).toEqual(['not-run', 'not-run', 'not-run']);
    expect(state(10)).toBe('answered');
    expect(state(11)).toBe('not-run');
    expect(model.held()).toEqual([3]);
  });

  it('moves the held ring with the pause while the rail is stale', () => {
    const model = new FakeModel(source);
    publishRun([]);
    act(() => useDebuggerStore.setState({ pausedFrame: { tabId: 't1', line: 2 } as never }));
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t1" stale />);
    expect(model.held()).toEqual([2]);
    act(() => useDebuggerStore.setState({ pausedFrame: { tabId: 't1', line: 4 } as never }));
    expect(model.held()).toEqual([4]);
    act(() => useDebuggerStore.setState({ pausedFrame: null }));
    expect(model.held()).toEqual([]);
  });

  it('sends the pulse down the rail once per new run, then leaves the ticks lit', () => {
    vi.useFakeTimers();
    const model = new FakeModel(source);
    publishRun([4]);
    render(<PulseRailHost editor={fakeEditor(model) as never} monaco={monaco as never} tabId="t1" />);
    expect(model.rail()[1]).toBe('lingua-rail lingua-rail--reached');
    act(() => useExecutionHistoryStore.setState({ entries: [{ id: 'other', tabId: 't2' }] as never }));
    expect(model.rail()[1]).toBe('lingua-rail lingua-rail--reached');
    act(() => useExecutionHistoryStore.setState({ entries: [{ id: 'r1', tabId: 't1' }] as never }));
    expect(model.rail()[1]).toBe('lingua-rail lingua-rail--reached lingua-rail--pass lingua-rail--slot-0');
    expect(model.rail()[4]).toContain('lingua-rail--slot-');
    act(() => vi.advanceTimersByTime(2_000));
    expect(model.rail()[4]).toBe('lingua-rail lingua-rail--answered');
  });

  it('leaves the marks where Monaco moved them while the results are stale', () => {
    const model = new FakeModel(source);
    const editor = fakeEditor(model);
    const { rerender } = render(<PulseRailHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
    publishRun([4]);
    const before = model.rail();
    rerender(<PulseRailHost editor={editor as never} monaco={monaco as never} tabId="t1" stale />);
    act(() => useUIStore.setState({ consoleVisible: true, activeBottomPanel: 'timeline' }));
    publishRun([1]);
    expect(model.rail()).toEqual(before);
  });

  it('moves its marks off a tab when the editor switches models', () => {
    const first = new FakeModel(source);
    const editor = fakeEditor(first);
    render(<PulseRailHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
    publishRun([4]);
    const second = new FakeModel(source);
    act(() => editor.swap(second));
    expect(first.rail()).toEqual({});
    expect(second.rail()[4]).toBe('lingua-rail lingua-rail--answered');
  });
});
