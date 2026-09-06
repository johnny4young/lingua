import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTab } from '../../src/renderer/types/editor';
import type { ConsoleOutput, ExecutionResult } from '../../src/renderer/types/execution';

const { prepare, execute, isSupported, validate } = vi.hoisted(() => ({
  prepare: vi.fn(),
  execute: vi.fn(),
  isSupported: vi.fn(),
  validate: vi.fn(),
}));
vi.mock('../../src/renderer/runners', () => ({
  runnerManager: { prepareRunner: prepare, isSupported, needsInitialization: () => false },
}));
vi.mock('../../src/renderer/validation', () => ({ validateDocument: validate }));
vi.mock('../../src/renderer/utils/telemetry', () => ({ trackEvent: vi.fn() }));

import { executeTabManually } from '../../src/renderer/runtime/executeTabManually';
import { useConsoleStore } from '../../src/renderer/stores/consoleStore';

const tab: FileTab = {
  id: 'batch-run',
  name: 'main.js',
  language: 'javascript',
  content: 'console.log("streamed")',
  isDirty: false,
};
const output: ConsoleOutput = { type: 'log', args: ['streamed'], line: 1 };
const result: ExecutionResult = { stdout: [output], stderr: [], executionTime: 12 };

// Keep the actual batcher/store/presentation. Suppress scheduled callbacks so
// only explicit completion flushes can deliver output before the promise settles.
describe('executeTabManually — console delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    );
    useConsoleStore.getState().clear();
    prepare.mockReset().mockResolvedValue({ runner: { execute }, initialized: false });
    isSupported.mockReset().mockReturnValue(true);
    validate
      .mockReset()
      .mockReturnValue({ diagnostics: [], fullOutput: 'valid', executionTime: 1 });
    execute.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const contents = () => useConsoleStore.getState().entries.map(entry => entry.content);

  it.each(['success', 'cancelled', 'error', 'throw'] as const)(
    'delivers streamed output and terminal entries before %s resolves',
    async outcome => {
      execute.mockImplementation(
        async (_source: string, context: { onConsole: (value: ConsoleOutput) => void }) => {
          context.onConsole(output);
          expect(contents()).toEqual([]);
          if (outcome === 'throw') throw new Error('stream failure');
          return {
            ...result,
            ...(outcome === 'cancelled' ? { cancelled: true, error: { message: 'stopped' } } : {}),
            ...(outcome === 'error' ? { error: { message: 'bad input' } } : {}),
          };
        }
      );
      const summary = await executeTabManually(tab, { recordHistory: false });
      expect(summary.ok).toBe(outcome === 'success');
      expect(contents()).toEqual([
        'Running main.js...',
        'streamed',
        ...(outcome === 'throw'
          ? ['Unexpected error: stream failure']
          : outcome === 'cancelled'
            ? ['stopped']
            : outcome === 'error'
              ? ['bad input', 'Completed in 12.0 ms']
              : ['Completed in 12.0 ms']),
      ]);
      const delivered = useConsoleStore.getState().entries;
      await vi.runAllTimersAsync();
      expect(useConsoleStore.getState().entries).toBe(delivered);
    }
  );

  it.each(['missing', 'throw'] as const)('flushes an initialization %s failure', async failure => {
    if (failure === 'missing') prepare.mockResolvedValue({ runner: null });
    else prepare.mockRejectedValue(new Error('boot failed'));
    const summary = await executeTabManually(tab, { recordHistory: false });
    expect(summary.ok).toBe(false);
    expect(contents()).toEqual([
      'Running main.js...',
      failure === 'missing'
        ? 'Failed to initialize javascript runner.'
        : 'Failed to initialize javascript runner: boot failed',
    ]);
  });

  it('does not resurrect pre-clear queued output when the run finishes', async () => {
    execute.mockImplementation(
      async (_source: string, context: { onConsole: (value: ConsoleOutput) => void }) => {
        context.onConsole({ ...output, args: ['before clear'] });
        useConsoleStore.getState().clear();
        context.onConsole({ ...output, args: ['after clear'] });
        return { ...result, stdout: [] };
      }
    );
    await executeTabManually(tab, { recordHistory: false });
    expect(contents()).toEqual(['after clear', 'Completed in 12.0 ms']);
  });

  it('flushes the unsupported-runner early return', async () => {
    isSupported.mockReturnValue(false);
    await executeTabManually(tab, { recordHistory: false });
    expect(contents()).toEqual([
      'Runner for javascript is not available yet. Coming in a future update.',
    ]);
  });

  it('flushes the view-only early return', async () => {
    const summary = await executeTabManually({ ...tab, language: 'markdown', name: 'note.md' });
    expect(summary.mode).toBe('view');
    expect(contents()).toEqual([
      'note.md is editable, but Lingua does not run or lint this file type yet.',
    ]);
  });

  it('flushes successful validation', async () => {
    await executeTabManually({ ...tab, language: 'json', name: 'data.json' });
    expect(contents()).toEqual(['Validating data.json...', 'Validation passed for data.json.']);
  });

  it('drains queued validation output even when validation throws', async () => {
    validate.mockImplementation(() => {
      throw new Error('validation failed');
    });
    await expect(
      executeTabManually({ ...tab, language: 'json', name: 'data.json' })
    ).rejects.toThrow('validation failed');
    expect(contents()).toEqual(['Validating data.json...']);
  });
});
