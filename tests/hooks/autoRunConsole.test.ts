import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginAutoRunConsole } from '@/hooks/autoRunConsole';
import { useConsoleStore } from '@/stores/consoleStore';
import { useResultStore } from '@/stores/resultStore';

const contents = () => useConsoleStore.getState().entries.map(entry => entry.content);

describe('beginAutoRunConsole', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    useConsoleStore.setState({ entries: [], collapsedEntries: [], currentRun: null, previousRun: null });
    useResultStore.setState({ tabRuns: { tab: { count: 6, runs: [] } } });
    useConsoleStore.getState().beginRun({ tabId: 'tab', startedAt: 1_000, number: 6 });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'api', line: 5 });
  });
  afterEach(() => vi.useRealTimers());

  it('starts the next run timed from now and streams its rows', () => {
    const run = beginAutoRunConsole('tab', 'python', () => true, true);
    expect(useConsoleStore.getState().currentRun).toEqual({ tabId: 'tab', number: 7, startedAt: 10_000 });
    expect(useConsoleStore.getState().previousRun?.rows.map(row => row.entry.content)).toEqual(['api']);
    run.onConsole({ type: 'log', args: ['worker'], line: 5 });
    expect(run.settle(7)).toBe(true);
    expect(contents()).toEqual(['worker']);
  });

  it('drops output once the run is no longer current', () => {
    let current = true;
    const run = beginAutoRunConsole('tab', 'python', () => current, true);
    current = false;
    run.onConsole({ type: 'log', args: ['late'], line: 5 });
    expect(run.settle(7)).toBe(false);
    expect(useConsoleStore.getState().currentRun?.startedAt).toBeNull();
    expect(contents()).toEqual([]);
  });

  it('leaves a Browser preview refresh out of the console until it settles', () => {
    const run = beginAutoRunConsole('tab', 'javascript', () => true, false);
    expect(contents()).toEqual(['api']);
    expect(useConsoleStore.getState().currentRun?.startedAt).toBeNull();
    expect(run.settle(7)).toBe(false);
    expect(useConsoleStore.getState().currentRun).toEqual({ tabId: 'tab', number: 7, startedAt: null });
    expect(contents()).toEqual([]);
  });

  it('gives the console back when the run is dropped and nothing newer began', () => {
    const run = beginAutoRunConsole('tab', 'python', () => true, true);
    run.revert();
    expect(contents()).toEqual(['api']);
    expect(useConsoleStore.getState().currentRun).toEqual({ tabId: 'tab', number: 6, startedAt: 1_000 });
  });

  it('leaves a newer run alone when the dropped one settles late', () => {
    const dropped = beginAutoRunConsole('tab', 'python', () => false, true);
    const newer = beginAutoRunConsole('tab', 'python', () => true, true);
    newer.onConsole({ type: 'log', args: ['fresh'], line: 5 });
    newer.settle(7);
    dropped.revert();
    expect(contents()).toEqual(['fresh']);
    expect(useConsoleStore.getState().previousRun?.number).toBe(6);
  });
});
