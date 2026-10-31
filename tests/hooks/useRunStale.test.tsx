import { act, render, renderHook, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { useRunStale, useRunStaleAge } from '@/hooks/useRunStale';
import { RunStalePill } from '@/components/Editor/RunStalePill';
import { useEditorStore } from '@/stores/editorStore';
import { useResultStore } from '@/stores/resultStore';
import { useSettingsStore } from '@/stores/settingsStore';

const initialResult = useResultStore.getState();
const initialSettings = useSettingsStore.getState();

function openTab(workflowMode: 'run' | 'scratchpad', language = 'javascript', content = 'const a = 2;') {
  useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language, content, workflowMode }] as never, 't1');
}

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  useSettingsStore.setState({ featureFlags: { runState: true } });
  useResultStore.setState({ ranCode: { tabId: 't1', code: 'const a = 1;', at: 1_000 }, lineResults: [{ line: 1, value: '1', type: 'result' }] });
});

afterEach(() => {
  useResultStore.setState(initialResult, true);
  useSettingsStore.setState(initialSettings, true);
  useEditorStore.getState().restoreTabs([], null);
});

describe('run state', () => {
  it('is stale once a Run-mode tab no longer holds the code its results ran from', () => {
    openTab('run');
    const { result } = renderHook(() => useRunStale());
    expect(result.current).toEqual({ stale: true, ranAt: 1_000 });
    act(() => useEditorStore.getState().updateContent('t1', 'const a = 1;'));
    expect(result.current.stale).toBe(false);
  });

  it('stays current with the flag off, while running, without results, or for another tab', () => {
    openTab('run');
    const { result } = renderHook(() => useRunStale());
    act(() => useResultStore.setState({ isManualRunning: true }));
    expect(result.current.stale).toBe(false);
    act(() => useResultStore.setState({ isManualRunning: false, lineResults: [], fullOutput: '', error: null }));
    expect(result.current.stale).toBe(false);
    act(() => useResultStore.setState({ lineResults: [{ line: 1, value: '1', type: 'result' }], ranCode: { tabId: 'other', code: '', at: 1 } }));
    expect(result.current.stale).toBe(false);
    act(() => {
      useResultStore.setState({ ranCode: { tabId: 't1', code: 'const a = 1;', at: 1_000 } });
      useSettingsStore.setState({ featureFlags: {} });
    });
    expect(result.current.stale).toBe(false);
  });

  it('treats a Scratchpad that runs itself as current unless an incomplete edit holds it', () => {
    openTab('scratchpad');
    const { result } = renderHook(() => useRunStale());
    expect(result.current.stale).toBe(false);
    act(() => useResultStore.setState({ autoRunGateReason: 'incomplete' }));
    expect(result.current.stale).toBe(true);
  });

  it('lets Browser preview follow its own refresh, whatever the JS policy says', () => {
    useSettingsStore.setState({ runPolicyByGroup: { jsTs: 'manual', pythonRuby: 'pause', goRust: 'manual' } });
    useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: 'x', workflowMode: 'scratchpad', runtimeMode: 'browser-preview' }] as never, 't1');
    const { result } = renderHook(() => useRunStale());
    expect(result.current.stale).toBe(false);
    act(() => useSettingsStore.setState({ browserPreviewRefreshIntervalMs: 0 }));
    expect(result.current.stale).toBe(true);
  });

  it('marks a Manual Scratchpad stale as soon as the code changes', () => {
    openTab('scratchpad', 'go', 'package main');
    const { result } = renderHook(() => useRunStale());
    expect(result.current.stale).toBe(true);
  });

  it('shows a STALE pill that explains itself, and ages the results', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(13_000);
      openTab('run');
      render(<RunStalePill />);
      expect(screen.getByTestId('run-stale-pill').textContent).toContain('Stale');
      expect(screen.getByTestId('run-stale-pill').getAttribute('title')).toBe('Edited after the last run · values dimmed');
      const { result } = renderHook(() => useRunStaleAge(1_000));
      expect(result.current).toBe('12 sec. ago');
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(result.current).toBe('17 sec. ago');
    } finally {
      vi.useRealTimers();
    }
  });
});
