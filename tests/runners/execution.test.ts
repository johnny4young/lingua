import { vi, describe, it, expect } from 'vitest';
import { JavaScriptRunner } from '@/runners/javascript';

// ---------------------------------------------------------------------------
// Mock the Worker global to simulate worker message protocol
// ---------------------------------------------------------------------------

vi.stubGlobal(
  'Worker',
  class MockWorker {
    private messageListeners: Array<(e: MessageEvent) => void> = [];
    private errorListeners: Array<(e: ErrorEvent) => void> = [];

    addEventListener(event: string, cb: (e: MessageEvent | ErrorEvent) => void) {
      if (event === 'message') {
        this.messageListeners.push(cb as (e: MessageEvent) => void);
      } else if (event === 'error') {
        this.errorListeners.push(cb as (e: ErrorEvent) => void);
      }
    }

    postMessage(message: { runId?: string }) {
      setTimeout(() => {
        for (const listener of this.messageListeners) {
          listener(
            new MessageEvent('message', {
              data: {
                type: 'console',
                runId: message.runId,
                method: 'log',
                args: ['hello'],
              },
            })
          );
        }
        for (const listener of this.messageListeners) {
          listener(
            new MessageEvent('message', {
              data: {
                type: 'done',
                runId: message.runId,
                executionTime: 1,
              },
            })
          );
        }
      }, 0);
    }
    terminate() {}
  }
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JavaScriptRunner execution integration', () => {
  it('init() resolves and marks runner as ready', async () => {
    const runner = new JavaScriptRunner();
    expect(runner.isReady()).toBe(false);
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('execute() returns stdout with the expected console.log output', async () => {
    const runner = new JavaScriptRunner();
    await runner.init();

    const result = await runner.execute('console.log("hello")', {});

    expect(result.stdout).toHaveLength(1);
    expect(result.stdout[0].args[0]).toBe('hello');
    expect(result.stdout[0].type).toBe('log');
  });

  it('execute() returns an executionTime', async () => {
    const runner = new JavaScriptRunner();
    await runner.init();

    const result = await runner.execute('console.log("hello")', {});
    expect(typeof result.executionTime).toBe('number');
  });

  it('execute() returns empty stderr for a clean run', async () => {
    const runner = new JavaScriptRunner();
    await runner.init();

    const result = await runner.execute('console.log("hello")', {});
    expect(result.stderr).toHaveLength(0);
  });

  it('stop() terminates the worker without error', async () => {
    const runner = new JavaScriptRunner();
    await runner.init();
    // Start execution but stop immediately
    const execPromise = runner.execute('console.log("hello")', {});
    runner.stop();
    // The promise still resolves because stop() terminates mid-flight;
    // the existing listeners are already wired up before stop() runs
    const result = await execPromise;
    expect(result.cancelled).toBe(true);
  });
});
