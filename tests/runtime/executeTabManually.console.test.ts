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
import { useResultStore } from '../../src/renderer/stores/resultStore';

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
              ? ['bad input', 'Failed in 12.0 ms']
              : ['Completed in 12.0 ms']),
      ]);
      const delivered = useConsoleStore.getState().entries;
      await vi.runAllTimersAsync();
      expect(useConsoleStore.getState().entries).toBe(delivered);
    }
  );

  it('keeps the observed stream order in the final result and console without mutating captures', async () => {
    const first: ConsoleOutput = { type: 'error', args: ['one'], line: 1 };
    const middle: ConsoleOutput = { type: 'log', args: ['two'], line: 1 };
    const last: ConsoleOutput = { type: 'error', args: ['three'], line: 1 };
    execute.mockImplementation(async (_source: string, context: { onConsole: (value: ConsoleOutput) => void }) => {
      for (const value of [first, middle, last]) context.onConsole(value);
      return { stdout: [middle], stderr: [first, last], executionTime: 1, error: { message: 'fatal' } };
    });
    await executeTabManually(tab, { recordHistory: false });
    expect(contents()).toEqual(['Running main.js...', 'one', 'two', 'three', 'fatal', 'Failed in 1.0 ms']);
    expect(useResultStore.getState().lineResults.map(row => row.value)).toEqual(['one', 'two', 'three', 'fatal']);
    expect(first).not.toHaveProperty('captureOrder');
  });

  it('does not announce completion for an explicit error outcome without a message', async () => {
    execute.mockResolvedValue({ stdout: [], stderr: [], executionTime: 12, kind: 'error' });
    const summary = await executeTabManually(tab, { recordHistory: false });
    expect(summary.ok).toBe(false);
    expect(summary.message).toBe('Failed in 12.0 ms');
    expect(contents()).toEqual(['Running main.js...', 'Failed in 12.0 ms']);
  });

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

  it('names the running tab in the execution context', async () => {
    execute.mockResolvedValue(result);

    await executeTabManually(tab, { recordHistory: false });

    expect(execute).toHaveBeenCalledWith(
      tab.content,
      expect.objectContaining({ tabId: 'batch-run' })
    );
  });

  it('updates the result panel from streamed output at most once per frame and never after the run settles', async () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: () => void) => {
        frames.push(callback);
        return frames.length;
      })
    );
    let emit: ((value: ConsoleOutput) => void) | undefined;
    let finish!: (value: ExecutionResult) => void;
    execute.mockImplementation(
      (_source: string, context: { onConsole: (value: ConsoleOutput) => void }) => {
        emit = context.onConsole;
        return new Promise<ExecutionResult>(resolve => {
          finish = resolve;
        });
      }
    );
    // JavaScript shows streamed output as inline line results.
    const panel = () => useResultStore.getState().lineResults.map(line => line.value);

    const run = executeTabManually(tab, { recordHistory: false });
    for (let tick = 0; tick < 50 && !emit; tick += 1) await Promise.resolve();
    frames.splice(0).forEach(frame => frame());

    emit!({ type: 'log', args: ['one'] });
    emit!({ type: 'log', args: ['two'] });
    emit!({ type: 'log', args: ['three'] });
    // Three streamed lines queue one console flush and one panel update.
    expect(frames).toHaveLength(2);
    expect(panel()).toEqual([]);
    frames.splice(0).forEach(frame => frame());
    expect(panel()).toEqual(['one', 'two', 'three']);

    emit!({ type: 'log', args: ['late'] });
    finish({ stdout: [{ type: 'log', args: ['final'] }], stderr: [], executionTime: 5 });
    await run;
    const published = useResultStore.getState().lineResults;
    expect(panel()).toEqual(['final']);
    frames.splice(0).forEach(frame => frame());
    // The frame queued before the run settled must not overwrite the outcome.
    expect(useResultStore.getState().lineResults).toBe(published);
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
