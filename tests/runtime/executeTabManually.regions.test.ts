/** A run regions run executes the start of the tab and reports under its region. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockTrackEvent,
  mockRunnerManagerPrepare,
  mockRunnerExecute,
  mockCurrentEffectiveTier,
} = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
  mockRunnerManagerPrepare: vi.fn(),
  mockRunnerExecute: vi.fn(),
  mockCurrentEffectiveTier: vi.fn<[], 'free' | 'pro'>(() => 'pro'),
}));

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

vi.mock('../../src/renderer/runners', () => ({
  runnerManager: {
    prepareRunner: mockRunnerManagerPrepare,
    isSupported: () => true,
    needsInitialization: () => false,
  },
}));

vi.mock('../../src/renderer/stores/consoleStore', () => {
  const state = { addEntry: vi.fn(), addEntries: vi.fn(), clear: vi.fn() };
  return { useConsoleStore: { getState: () => state } };
});



vi.mock('../../src/renderer/validation', () => ({
  validateDocument: vi.fn(() => []),
}));

vi.mock('../../src/renderer/hooks/runnerOutput', async importOriginal => ({
  // Keep the real per-output mapper the streamed and cancelled paths share.
  ...(await importOriginal<typeof import('../../src/renderer/hooks/runnerOutput')>()),
  getCompilationLoadingMessage: () => null,
  getCompilationMessage: () => null,
  getInitializationMessage: () => null,
  toConsoleEntries: () => [],
}));

vi.mock('../../src/renderer/utils/executionPresentation', () => ({
  toExecutionPresentation: () => ({ lineResults: [], fullOutput: '' }),
}));


vi.mock('../../src/renderer/hooks/useEntitlement', () => ({
  currentEffectiveTier: mockCurrentEffectiveTier,
}));

import { useResultStore } from '../../src/renderer/stores/resultStore';
import { executeTabManually } from '../../src/renderer/runtime/executeTabManually';
import { useExecutionHistoryStore } from '../../src/renderer/stores/executionHistoryStore';
import { useRunRegionStore } from '../../src/renderer/stores/runRegionStore';
import { parseRunRegions } from '../../src/renderer/utils/runRegions';
import type { FileTab } from '../../src/renderer/types/editor';

const SOURCE = ['const a = 1;', '// %% first', 'console.log(a);', '// %% second', 'console.log("later");'].join('\n');
const tab: FileTab = { id: 'tab-r', name: 'main.js', language: 'javascript', content: SOURCE, isDirty: false };
const initialHistory = useExecutionHistoryStore.getState();
const initialResultState = useResultStore.getState();

describe('executeTabManually — run regions', () => {
  beforeEach(() => {
    useResultStore.setState(initialResultState, true);
    useExecutionHistoryStore.setState(initialHistory, true);
    useRunRegionStore.setState({ last: null });
    mockRunnerExecute.mockReset();
    mockRunnerManagerPrepare.mockReset();
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: { execute: mockRunnerExecute.mockResolvedValue({ stdout: [], stderr: [], result: undefined, executionTime: 3, error: undefined }) },
      initialized: false,
    });
  });

  afterEach(() => {
    useResultStore.setState(initialResultState, true);
    useExecutionHistoryStore.setState(initialHistory, true);
    vi.restoreAllMocks();
  });

  it('runs the file up to the end of the region, keeps no history and publishes the region result', async () => {
    const region = parseRunRegions(SOURCE, 'javascript')[1]!;
    const summary = await executeTabManually(tab, { region });

    expect(summary.ok).toBe(true);
    expect(mockRunnerExecute.mock.calls[0]![0]).toBe('const a = 1;\n// %% first\nconsole.log(a);');
    expect(mockRunnerExecute.mock.calls[0]![1]).toMatchObject({ autoLog: true });
    expect(useResultStore.getState().ranCode?.code).toBe(SOURCE);
    expect(useExecutionHistoryStore.getState().entries).toHaveLength(0);
    expect(useResultStore.getState().snapshotRing).toHaveLength(0);
    expect(useRunRegionStore.getState().last).toMatchObject({ tabId: 'tab-r', region, ok: true, executionTime: 3 });
  });

  it('drops the region result when the tab runs as a whole', async () => {
    await executeTabManually(tab, { region: parseRunRegions(SOURCE, 'javascript')[0]! });
    await executeTabManually(tab);

    expect(mockRunnerExecute.mock.calls[1]![0]).toBe(SOURCE);
    expect(useRunRegionStore.getState().last).toBeNull();
    expect(useExecutionHistoryStore.getState().entries).toHaveLength(1);
  });
});
