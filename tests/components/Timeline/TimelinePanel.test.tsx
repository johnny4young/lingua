import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { TimelinePanel } from '@/components/Timeline/TimelinePanel';
import { TimelineLineHost } from '@/components/Timeline/TimelineLineHost';
import { RecordRunMenuItem } from '@/components/Toolbar/RecordRunMenuItem';
import { useTimelineStore } from '@/stores/timelineStore';
import { useEditorStore } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { useAnnouncerStore } from '@/stores/announcerStore';
import type { TimelineStep } from '@/../shared/timeline';

const steps: TimelineStep[] = [
  { line: 10, frames: [{ name: '<module>', line: 10 }], vars: [['nums', '[ 3, 1 ]']] },
  { line: 2, frames: [{ name: '<module>', line: 11 }, { name: 'quickSort', line: 2 }], vars: [['arr', '[ 3, 1 ]']], log: 'log' },
  { line: 3, frames: [{ name: '<module>', line: 11 }, { name: 'quickSort', line: 3 }], vars: [['arr', '[ 3, 1 ]'], ['pivot', '1']], error: true },
];

const initialSettings = useSettingsStore.getState();

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  useTimelineStore.setState({ recording: { tabId: 't1', steps, total: 3, truncated: false, limited: false }, current: 2 });
});

afterEach(() => {
  useTimelineStore.setState({ recording: null, current: 0 });
  useSettingsStore.setState(initialSettings, true);
});

describe('timeline panel', () => {
  it('shows the step count, the strip and the state as of the selected step', () => {
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-summary').textContent).toBe('3 steps · recorded');
    const strip = screen.getByTestId('timeline-strip');
    expect(strip.getAttribute('aria-valuetext')).toBe('Step 3 of 3, line 3');
    expect(strip.querySelectorAll('[data-kind="log"]')).toHaveLength(1);
    expect(strip.querySelectorAll('[data-kind="error"]')).toHaveLength(1);
    expect(screen.getByTestId('timeline-watches').textContent).toContain('pivot1');
    expect(screen.getByTestId('timeline-stack').textContent).toBe('Call stackquickSort :3depth 1<module> :11');
  });

  it('steps back with the button and walks the strip with the keyboard', async () => {
    render(<TimelinePanel />);
    await userEvent.click(screen.getByTestId('timeline-back'));
    expect(screen.getByTestId('timeline-current').textContent).toBe('current step 2 · line 2');
    const strip = screen.getByTestId('timeline-strip');
    fireEvent.keyDown(strip, { key: 'Home' });
    expect(screen.getByTestId('timeline-watches').textContent).toContain('nums[ 3, 1 ]');
    fireEvent.keyDown(strip, { key: 'ArrowRight' });
    expect(useTimelineStore.getState().current).toBe(1);
    fireEvent.keyDown(strip, { key: 'End' });
    expect(useTimelineStore.getState().current).toBe(2);
  });

  it('picks the step under the click, inside the strip inset', () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ line: index + 1, frames: [], vars: [] }));
    useTimelineStore.setState({ recording: { tabId: 't1', steps: many, total: 101, truncated: false, limited: false }, current: 50 });
    render(<TimelinePanel />);
    const strip = screen.getByTestId('timeline-strip');
    strip.getBoundingClientRect = () => ({ left: 100, width: 216, top: 0, height: 30, right: 316, bottom: 30, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.click(strip, { clientX: 108 });
    expect(useTimelineStore.getState().current).toBe(0);
    fireEvent.click(strip, { clientX: 208 });
    expect(useTimelineStore.getState().current).toBe(50);
    fireEvent.click(strip, { clientX: 308 });
    expect(useTimelineStore.getState().current).toBe(100);
  });

  it('moves by depth with the buttons and keys, and announces a move with nowhere to go', async () => {
    useTimelineStore.setState({ current: 0 });
    render(<TimelinePanel />);
    await userEvent.click(screen.getByTestId('timeline-next'));
    expect(useTimelineStore.getState().current).toBe(1);
    await userEvent.click(screen.getByTestId('timeline-backOut'));
    expect(useTimelineStore.getState().current).toBe(0);
    const strip = screen.getByTestId('timeline-strip');
    fireEvent.keyDown(strip, { key: 'ArrowRight' });
    fireEvent.keyDown(strip, { key: 'ArrowRight', shiftKey: true });
    expect(useTimelineStore.getState().current).toBe(2);
    fireEvent.keyDown(strip, { key: 'ArrowLeft', altKey: true });
    expect(useTimelineStore.getState().current).toBe(0);
    await userEvent.click(screen.getByTestId('timeline-out'));
    expect(useTimelineStore.getState().current).toBe(0);
    expect(useAnnouncerStore.getState().message).toBe('No step to go to from here');
  });

  it('marks the other runs of the selected line as echoes', () => {
    const plain = (line: number): TimelineStep => ({ line, frames: [{ name: '<module>', line }], vars: [] });
    const repeated: TimelineStep[] = [plain(1), plain(2), plain(1), plain(2)];
    useTimelineStore.setState({ recording: { tabId: 't1', steps: repeated, total: 4, truncated: false, limited: false }, current: 3 });
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-echoes').textContent).toBe('echoes · line 2 ran 2×');
    expect(screen.getByTestId('timeline-strip').querySelectorAll('[data-kind="echo"]')).toHaveLength(1);
  });

  it('keeps the strip to its sample when the selected line ran more often than it has ticks', () => {
    const loop: TimelineStep[] = Array.from({ length: 2_000 }, (_, i) => ({ line: 5 + (i % 2), frames: [{ name: '<module>', line: 5 }], vars: [] }));
    useTimelineStore.setState({ recording: { tabId: 't1', steps: loop, total: loop.length, truncated: false, limited: false }, current: 0 });
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-strip').querySelectorAll('.timeline-tick').length).toBeLessThanOrEqual(401);
    expect(screen.getByTestId('timeline-echoes').textContent).toContain('1000');
  });

  it('says when Free kept only the last steps, and when the run stopped at the cap', async () => {
    useTimelineStore.setState(state => ({ recording: { ...state.recording!, total: 50, limited: true, truncated: true } }));
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-limited').textContent).toBe('PROFree keeps the last 3 of 50 steps');
    expect(screen.getByTestId('timeline-summary').textContent).toBe('50 steps · recorded · stopped recording at its cap');
  });

  it('reads in Spanish and explains an empty recording', async () => {
    await i18next.changeLanguage('es');
    useTimelineStore.setState({ recording: { tabId: 't1', steps: [], total: 0, truncated: false, limited: false }, current: 0 });
    render(<TimelinePanel />);
    expect(screen.getByText('Línea de tiempo de ejecución')).toBeTruthy();
    expect(screen.getByText('La ejecución no tuvo pasos para grabar.')).toBeTruthy();
  });
});

describe('timeline in the editor and the Run menu', () => {
  it('highlights the selected line only while the Timeline tab is open', () => {
    useSettingsStore.setState({ featureFlags: { runTimeline: true } });
    const clear = vi.fn();
    const model = { getLineCount: () => 20, getLineMaxColumn: () => 30 };
    const set = vi.fn();
    const editor = { getModel: () => model, createDecorationsCollection: vi.fn(() => ({ clear, set })), revealLineInCenterIfOutsideViewport: vi.fn() };
    const monaco = { Range: class { constructor(public line: number) {} } };
    useUIStore.setState({ consoleVisible: true, activeBottomPanel: 'console' });
    const { rerender } = render(<TimelineLineHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
    expect(editor.createDecorationsCollection).not.toHaveBeenCalled();
    useUIStore.setState({ activeBottomPanel: 'timeline' });
    rerender(<TimelineLineHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
    expect(editor.revealLineInCenterIfOutsideViewport).toHaveBeenCalledWith(3);
    useTimelineStore.setState({ current: 0 });
    rerender(<TimelineLineHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
    expect(set).toHaveBeenCalled();
    expect(editor.createDecorationsCollection).toHaveBeenCalledTimes(1);
    expect(editor.revealLineInCenterIfOutsideViewport).toHaveBeenLastCalledWith(10);
  });

  it('shows what the line changed, dims unreached lines and flashes a move with nowhere to go', () => {
    vi.useFakeTimers();
    try {
      useSettingsStore.setState({ featureFlags: { runTimeline: true } });
      useUIStore.setState({ consoleVisible: true, activeBottomPanel: 'timeline' });
      useTimelineStore.setState({ current: 1 });
      const model = { getLineCount: () => 20, getLineMaxColumn: () => 30 };
      const live: Array<{ decorations: unknown[] }> = [];
      const editor = {
        getModel: () => model,
        createDecorationsCollection: vi.fn((decorations: unknown[]) => {
          const collection = {
            decorations,
            set: (next: unknown[]) => { collection.decorations = next; },
            clear: () => { collection.decorations = []; },
          };
          live.push(collection);
          return collection;
        }),
        revealLineInCenterIfOutsideViewport: vi.fn(),
      };
      const monaco = { Range: class { constructor(public line: number, public column: number) {} } };
      render(<TimelineLineHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
      const last = () => JSON.stringify(live.map(collection => collection.decorations));
      expect(last()).toContain('"content":"pivot = 1"');
      expect(last()).toContain('"showIfCollapsed":true');
      expect(last()).toContain('"inlineClassName":"lingua-timeline-unreached"');
      expect(last()).not.toContain('lingua-timeline-blocked');
      act(() => { useTimelineStore.getState().go('out', false); });
      expect(last()).toContain('lingua-timeline-blocked');
      act(() => { vi.advanceTimersByTime(700); });
      expect(last()).not.toContain('lingua-timeline-blocked');
    } finally {
      vi.useRealTimers();
    }
  });

  it('strips bidi and control characters from the value pill', () => {
    useSettingsStore.setState({ featureFlags: { runTimeline: true } });
    useUIStore.setState({ consoleVisible: true, activeBottomPanel: 'timeline' });
    const tricky: TimelineStep[] = [
      { line: 1, frames: [{ name: '<module>', line: 1 }], vars: [] },
      { line: 2, frames: [{ name: '<module>', line: 2 }], vars: [['label', '"\u202eevil\nline\u2028x\u200f\u0085"']] },
    ];
    useTimelineStore.setState({ recording: { tabId: 't1', steps: tricky, total: 2, truncated: false, limited: false }, current: 0 });
    const created: unknown[] = [];
    const editor = {
      getModel: () => ({ getLineCount: () => 5, getLineMaxColumn: () => 10 }),
      createDecorationsCollection: vi.fn((decorations: unknown[]) => {
        created.push(decorations);
        return { clear: vi.fn(), set: vi.fn() };
      }),
      revealLineInCenterIfOutsideViewport: vi.fn(),
    };
    const monaco = { Range: class { constructor(public line: number) {} } };
    render(<TimelineLineHost editor={editor as never} monaco={monaco as never} tabId="t1" />);
    expect(JSON.stringify(created)).toContain('"content":"label = \\" evil line x  \\""');
  });

  it('offers Record run for JavaScript Worker tabs with the flag on', async () => {
    const onRecord = vi.fn();
    useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: '' }] as never, 't1');
    const { rerender } = render(<RecordRunMenuItem disabled={false} onRecord={onRecord} />);
    expect(screen.queryByTestId('action-pill-record')).toBeNull();
    useSettingsStore.setState({ featureFlags: { runTimeline: true } });
    rerender(<RecordRunMenuItem disabled={false} onRecord={onRecord} />);
    await userEvent.click(screen.getByTestId('action-pill-record'));
    expect(onRecord).toHaveBeenCalledOnce();
    useEditorStore.getState().restoreTabs([{ id: 't2', name: 'a.py', language: 'python', content: '' }] as never, 't2');
    rerender(<RecordRunMenuItem disabled={false} onRecord={onRecord} />);
    expect(screen.queryByTestId('action-pill-record')).toBeNull();
    useEditorStore.getState().restoreTabs([], null);
  });
});
