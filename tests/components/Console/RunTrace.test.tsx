import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@/i18n';
import { RunTrace } from '@/components/Console/RunTrace';
import { useTimelineStore } from '@/stores/timelineStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';
import type { TimelineStep } from '@/../shared/timeline';

const LINES = [1, 2, 3, 4, 3, 4, 3, 4, 5];
const steps: TimelineStep[] = LINES.map((line, index) => ({
  line,
  frames: [],
  vars: [],
  call: 0,
  depth: 0,
  ms: index * 10,
  ...(index === 3 ? { log: 'log' as const } : {}),
}));
const SOURCE = 'const a = 1;\nlet i = 0;\nwhile (i < 3) {\n  await sleep(0.4);\n}';

type Recording = NonNullable<ReturnType<typeof useTimelineStore.getState>['recording']>;
const record = (extra: Partial<Recording> = {}, current = 8) =>
  useTimelineStore.setState({
    recording: { tabId: 't1', steps, total: steps.length, truncated: false, limited: false, entitled: true, ms: 1080, code: SOURCE, ...extra },
    current,
  });

const initialEditor = useEditorStore.getState();
const initialUI = useUIStore.getState();

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  useEditorStore.setState({
    tabs: [{ id: 't1', name: 'a.js', language: 'javascript', content: SOURCE } as never],
    activeTabId: 't1',
  });
  record();
});

afterEach(() => {
  useTimelineStore.setState({ recording: null, current: 0 });
  useEditorStore.setState(initialEditor, true);
  useUIStore.setState(initialUI, true);
});

describe('run trace', () => {
  it('renders nothing for Free, another tab or a single step', () => {
    record({ entitled: false });
    const { container, rerender } = render(<RunTrace />);
    expect(container.innerHTML).toBe('');
    record({ tabId: 'other' });
    rerender(<RunTrace />);
    expect(container.innerHTML).toBe('');
    record({ steps: steps.slice(0, 1) }, 0);
    rerender(<RunTrace />);
    expect(container.innerHTML).toBe('');
  });

  it('draws the path, the dots and a label per pass of the loop', () => {
    render(<RunTrace />);
    expect(screen.getByTestId('run-trace-open').textContent).toBe('9 steps · scrub in Timeline');
    const chart = screen.getByTestId('run-trace-chart');
    expect(chart.getAttribute('aria-valuetext')).toBe('Step 9 of 9, line 5');
    expect(chart.getAttribute('aria-valuenow')).toBe('9');
    expect(chart.querySelector('.run-trace-path')?.getAttribute('d')).toMatch(/^M30\.0 6\.0H.*V126\.0$/u);
    expect(chart.querySelector('.run-trace-ahead')).toBeNull();
    expect(chart.querySelectorAll('.run-trace-dot')).toHaveLength(9);
    expect(chart.querySelectorAll('.run-trace-dot[data-kind="log"]')).toHaveLength(1);
    expect(chart.querySelectorAll('.run-trace-wash')).toHaveLength(1);
    expect(screen.getAllByTestId('run-trace-loop').map(label => label.textContent)).toEqual(['loop 1', 'loop 2', 'loop 3']);
  });

  it('dashes the steps after the selected one', () => {
    record({}, 4);
    render(<RunTrace />);
    const chart = screen.getByTestId('run-trace-chart');
    expect(chart.querySelector('.run-trace-ahead')).not.toBeNull();
    expect(chart.querySelectorAll('.run-trace-dot')).toHaveLength(5);
  });

  it('draws a recording in flight up to its last step with a dashed projection after it', () => {
    record({ live: true });
    render(<RunTrace />);
    const trace = screen.getByTestId('run-trace');
    expect(trace.getAttribute('aria-busy')).toBe('true');
    const chart = screen.getByTestId('run-trace-chart');
    expect(chart.querySelector('.run-trace-path')?.getAttribute('d')).toMatch(/^M30\.0 6\.0H/u);
    // Its steps fill 88% of the plot; the projection runs on from the last one to the edge.
    const projection = screen.getByTestId('run-trace-projection').getAttribute('d')!;
    expect(projection).toMatch(/^M(\d+\.\d) 126\.0H680\.0$/u);
    expect(Number(/^M(\d+\.\d)/u.exec(projection)![1])).toBeCloseTo(30 + 650 * 0.88, 0);
    expect(screen.getByTestId('run-trace-slowest')).toBeTruthy();
    // A loop still running reaches the right edge with the projection; a finished one does not.
    const washEnd = () => {
      const wash = screen.getByTestId('run-trace-chart').querySelector('.run-trace-wash')!;
      return Number(wash.getAttribute('x')) + Number(wash.getAttribute('width'));
    };
    expect(washEnd()).toBeLessThan(680);
    act(() => record({ live: true, steps: steps.slice(0, 8) }, 7));
    expect(washEnd()).toBeCloseTo(680, 0);
    act(() => record({ live: undefined }));
    expect(screen.queryByTestId('run-trace-projection')).toBeNull();
    expect(screen.getByTestId('run-trace').getAttribute('aria-busy')).toBeNull();
  });

  it('draws a Python recording, its loop passes and the line that slept', () => {
    const python = 'from time import sleep\nfor name in ["api", "db"]:\n    sleep(0.4)\n    print(name)\nprint("done")';
    const lines = [1, 2, 3, 4, 3, 4, 5];
    const times = [0, 1, 2, 402, 403, 803, 804];
    useEditorStore.setState({ tabs: [{ id: 't1', name: 'latencies.py', language: 'python', content: python } as never], activeTabId: 't1' });
    record({
      code: python,
      ms: 805,
      steps: lines.map((line, index) => ({ line, frames: [{ name: '<module>', line }], vars: [], call: 0, depth: 0, ms: times[index], ...(line === 4 ? { log: 'log' as const } : {}) })),
    }, 6);
    render(<RunTrace />);
    expect(screen.getAllByTestId('run-trace-loop').map(label => label.textContent)).toEqual(['loop 1', 'loop 2']);
    expect(screen.getByTestId('run-trace-slowest').textContent).toBe('L3 sleep(0.4) · 800 ms · 99%');
  });

  it('selects the step under a click and opens the timeline', () => {
    render(<RunTrace />);
    const chart = screen.getByTestId('run-trace-chart');
    chart.getBoundingClientRect = () => ({ left: 100, width: 440, top: 0, height: 132, right: 540, bottom: 132, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.click(chart, { clientX: 100 + 30 + 152 });
    expect(useTimelineStore.getState().current).toBe(3);
    expect(useUIStore.getState().activeBottomPanel).toBe('timeline');
  });

  it('opens the timeline from the text button', () => {
    render(<RunTrace />);
    fireEvent.click(screen.getByTestId('run-trace-open'));
    expect(useUIStore.getState().activeBottomPanel).toBe('timeline');
  });

  it('walks the steps with the keyboard and opens the timeline on Enter', () => {
    render(<RunTrace />);
    const chart = screen.getByTestId('run-trace-chart');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(useTimelineStore.getState().current).toBe(7);
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(useTimelineStore.getState().current).toBe(0);
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(useTimelineStore.getState().current).toBe(1);
    fireEvent.keyDown(chart, { key: 'End' });
    expect(useTimelineStore.getState().current).toBe(8);
    expect(useUIStore.getState().activeBottomPanel).not.toBe('timeline');
    fireEvent.keyDown(chart, { key: 'Enter' });
    expect(useUIStore.getState().activeBottomPanel).toBe('timeline');
  });

  it('names the slowest line with its source, time and share', () => {
    render(<RunTrace />);
    expect(screen.getByTestId('run-trace-time').textContent).toContain('time');
    const slowest = screen.getByTestId('run-trace-slowest');
    expect(slowest.textContent).toBe('L5 } · 1.00 s · 92%');
    expect(slowest.getAttribute('aria-label')).toBe('Slowest line 5: 1.00 s, 92% of the run');
  });

  it('hides the time row when the recording was cut short or has no clock', () => {
    record({ truncated: true });
    const { rerender } = render(<RunTrace />);
    expect(screen.queryByTestId('run-trace-time')).toBeNull();
    record({ ms: undefined });
    rerender(<RunTrace />);
    expect(screen.queryByTestId('run-trace-time')).toBeNull();
    record({ steps: steps.map(({ ms: _ms, ...step }) => step) });
    rerender(<RunTrace />);
    expect(screen.queryByTestId('run-trace-time')).toBeNull();
  });

  it('reads in Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<RunTrace />);
    expect(screen.getAllByTestId('run-trace-loop')[0]!.textContent).toBe('vuelta 1');
  });

  it('labels the slowest line from the recorded code, not later edits', () => {
    useEditorStore.setState({ tabs: [{ id: 't1', name: 'a.js', language: 'javascript', content: 'edited\n'.repeat(9) } as never] });
    render(<RunTrace />);
    expect(screen.getByTestId('run-trace-slowest').textContent).not.toContain('edited');
  });
});
