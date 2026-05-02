/**
 * RL-028 Slice 6 trailer — replayHistoryEntry helper.
 *
 * The helper backs both the console-popover Replay button (Slice 6) and
 * the command-palette per-entry Replay action (this slice). Tests pin
 * the four exit conditions: run-in-progress short circuit,
 * no-snapshot short circuit, addTab tier-ceiling rejection, and the
 * happy path where a fresh tab opens and the runner fires with
 * `recordHistory: false`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionHistoryEntry } from '@/stores/executionHistoryStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';
import { replayHistoryEntry } from '@/utils/replayHistoryEntry';

const initialEditor = useEditorStore.getState();
const initialUI = useUIStore.getState();

function makeEntry(overrides?: Partial<ExecutionHistoryEntry>): ExecutionHistoryEntry {
  return {
    id: 'entry-1',
    language: 'javascript',
    status: 'ok',
    durationMs: 12,
    timestamp: 1_700_000_000_000,
    snapshot: {
      code: 'console.log("hi")',
      language: 'javascript',
      truncated: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  useEditorStore.setState(initialEditor, true);
  useUIStore.setState(initialUI, true);
});

afterEach(() => {
  useEditorStore.setState(initialEditor, true);
  useUIStore.setState(initialUI, true);
});

describe('replayHistoryEntry helper', () => {
  it('refuses to replay while a run is already in progress and surfaces the running notice', () => {
    const run = vi.fn();
    replayHistoryEntry(makeEntry(), { isRunning: true, run });

    expect(run).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'executionHistory.replay.running'
    );
    // No tab opened.
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  it('refuses to replay when the entry has no snapshot and surfaces the noSnapshot notice', () => {
    const run = vi.fn();
    replayHistoryEntry(makeEntry({ snapshot: null }), { isRunning: false, run });

    expect(run).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'executionHistory.replay.noSnapshot'
    );
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  it('opens a new tab with the captured snapshot and dispatches the run with recordHistory: false', () => {
    const run = vi.fn();
    replayHistoryEntry(makeEntry(), { isRunning: false, run });

    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.content).toBe('console.log("hi")');
    expect(tabs[0]?.language).toBe('javascript');
    expect(tabs[0]?.isDirty).toBe(false);
    expect(tabs[0]?.name).toMatch(/^replay-/);
    expect(useEditorStore.getState().activeTabId).toBe(tabs[0]?.id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ recordHistory: false });
  });

  it('surfaces the openFailed notice when addTab refused to make the new tab active', () => {
    // Simulate the tier-ceiling case by mocking addTab to leave the
    // store untouched so the post-add `activeTabId` check fails. This
    // mirrors what the editor store does when a Free user hits the
    // tab ceiling — addTab returns silently without flipping active.
    const run = vi.fn();
    type AddTab = ReturnType<typeof useEditorStore.getState>['addTab'];
    const spyAddTab = vi.fn<Parameters<AddTab>, ReturnType<AddTab>>(() => {
      /* refused: no state change */
    });
    useEditorStore.setState({ addTab: spyAddTab as unknown as AddTab });

    replayHistoryEntry(makeEntry(), { isRunning: false, run });

    expect(spyAddTab).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'executionHistory.replay.openFailed'
    );
  });

  it('captures an empty-string snapshot — distinguishable from "not tracked" — and still replays', () => {
    const run = vi.fn();
    const empty = makeEntry({
      snapshot: { code: '', language: 'javascript', truncated: false },
    });
    replayHistoryEntry(empty, { isRunning: false, run });

    expect(useEditorStore.getState().tabs[0]?.content).toBe('');
    expect(run).toHaveBeenCalledWith({ recordHistory: false });
  });
});
