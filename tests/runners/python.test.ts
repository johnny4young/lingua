import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PythonRunner } from '@/runners/python';
import { useEnvVarsStore } from '@/stores/envVarsStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';

describe('PythonRunner', () => {
  it('should have correct metadata', () => {
    const runner = new PythonRunner();
    expect(runner.id).toBe('python');
    expect(runner.name).toBe('Python (Pyodide)');
    expect(runner.language).toBe('python');
    expect(runner.extensions).toContain('.py');
  });

  it('should not be ready before init', () => {
    const runner = new PythonRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('should be ready after init (Pyodide loads lazily)', async () => {
    const runner = new PythonRunner();
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('should stop without error when no worker is running', () => {
    const runner = new PythonRunner();
    expect(() => runner.stop()).not.toThrow();
  });

  it('should reset state on stop', async () => {
    const runner = new PythonRunner();
    await runner.init();
    runner.stop();
    // After stop, calling stop again should not throw
    expect(() => runner.stop()).not.toThrow();
  });
});

describe('PythonRunner — RL-011 Slice D env wiring', () => {
  const initialEnv = useEnvVarsStore.getState();
  const initialEditor = useEditorStore.getState();
  const initialProject = useProjectStore.getState();

  let originalWorker: typeof globalThis.Worker;
  let originalLingua: unknown;
  let postedMessages: Array<Record<string, unknown>>;

  class MockWorker {
    private listeners = new Map<string, (event: MessageEvent) => void>();

    constructor(_url: URL | string, _options?: WorkerOptions) {}

    addEventListener(type: string, handler: (event: MessageEvent) => void): void {
      this.listeners.set(type, handler);
    }

    removeEventListener(): void {
      // no-op for the test
    }

    postMessage(message: Record<string, unknown>): void {
      postedMessages.push(message);
      if (message.type === 'init') {
        this.listeners.get('message')?.({
          data: { type: 'ready' },
        } as MessageEvent);
        return;
      }
      if (message.type === 'execute') {
        // Synthesize a successful done so the runner promise resolves.
        const handler = this.listeners.get('message');
        if (typeof message.stdin === 'string') {
          handler?.({
            data: {
              type: 'stdin-consumed',
              runId: message.runId,
              count: 1,
              total: 2,
            },
          } as MessageEvent);
        }
        handler?.({
          data: {
            type: 'done',
            runId: message.runId,
            executionTime: 1,
          },
        } as MessageEvent);
      }
    }

    terminate(): void {
      // no-op for the test
    }
  }

  beforeEach(() => {
    postedMessages = [];
    useEnvVarsStore.setState(initialEnv, true);
    useEditorStore.setState(initialEditor, true);
    useProjectStore.setState(initialProject, true);
    originalWorker = globalThis.Worker;
    originalLingua = (window as Window & { lingua?: unknown }).lingua;
    Object.defineProperty(globalThis, 'Worker', {
      value: MockWorker,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'Worker', {
      value: originalWorker,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'lingua', {
      value: originalLingua,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('forwards the merged user env (global + project + tab) on the execute message', async () => {
    useEnvVarsStore.setState({
      global: { SHARED: 'from-global', GLOBAL_ONLY: 'g' },
      project: { 'proj-1': { SHARED: 'from-project', PROJECT_ONLY: 'p' } },
      tab: { 'tab-1': { SHARED: 'from-tab', TAB_ONLY: 't' } },
    });
    useProjectStore.setState({
      currentProject: {
        id: 'proj-1',
        name: 'Fixture',
        rootPath: '/tmp/fixture',
        openedAt: Date.now(),
      },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-1',
          name: 'main.py',
          language: 'python',
          content: '',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-1',
    });

    const runner = new PythonRunner();
    await runner.init();
    await runner.execute('print("hi")');

    const executeMessage = postedMessages.find((m) => m.type === 'execute');
    expect(executeMessage).toBeDefined();
    expect(executeMessage?.runId).toEqual(expect.any(String));
    expect(executeMessage?.resultTruncationMarker).toBe('[result truncated]');
    expect(executeMessage?.userEnv).toMatchObject({
      SHARED: 'from-tab',
      GLOBAL_ONLY: 'g',
      PROJECT_ONLY: 'p',
      TAB_ONLY: 't',
    });
  });

  it('forwards an empty userEnv record when no tiers have values', async () => {
    const runner = new PythonRunner();
    await runner.init();
    await runner.execute('print("hi")');

    const executeMessage = postedMessages.find((m) => m.type === 'execute');
    expect(executeMessage?.userEnv).toEqual({});
  });

  it('forwards stdin and relays the worker consumption summary', async () => {
    const runner = new PythonRunner();
    await runner.init();
    const result = await runner.execute('name = input()', {
      stdin: 'Ada\nGrace',
    });

    const executeMessage = postedMessages.find((m) => m.type === 'execute');
    expect(executeMessage?.stdin).toBe('Ada\nGrace');
    expect(result.stdinConsumed).toEqual({ count: 1, total: 2 });
  });

  // RL-044 Slice 1C — payload pass-through + telemetry coverage.

  it('forwards rich console payload from the Pyodide worker to ConsoleOutput', async () => {
    class PayloadWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();
      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        this.listeners.set(type, handler);
      }
      removeEventListener(): void {}
      postMessage(message: Record<string, unknown>): void {
        if (message.type === 'init') {
          this.listeners.get('message')?.({ data: { type: 'ready' } } as MessageEvent);
          return;
        }
        if (message.type === 'execute') {
          const handler = this.listeners.get('message');
          handler?.({
            data: {
              type: 'console',
              runId: message.runId,
              method: 'log',
              args: ['dict({a: 1})'],
              payload: [
                {
                  kind: 'object',
                  previewType: 'dict',
                  entries: [
                    { key: 'a', value: { kind: 'primitive', type: 'number', repr: '1' } },
                  ],
                },
              ],
            },
          } as MessageEvent);
          handler?.({
            data: { type: 'done', runId: message.runId, executionTime: 1 },
          } as MessageEvent);
        }
      }
      terminate(): void {}
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: PayloadWorker,
      writable: true,
      configurable: true,
    });

    const runner = new PythonRunner();
    await runner.init();
    const result = await runner.execute('print({"a": 1})');

    expect(result.stdout).toHaveLength(1);
    const entry = result.stdout[0]!;
    expect(entry.args).toEqual(['dict({a: 1})']);
    expect(entry.payload).toBeDefined();
    expect(entry.payload![0]).toMatchObject({ kind: 'object', previewType: 'dict' });
  });

  it('omits payload when the worker emits the legacy text-only console shape', async () => {
    // Drive a REAL console message that lacks the `payload` field to
    // exercise the runner's `msg.payload ? … : …` branch. This is the
    // path triggered when fold-E is OFF or when sys.stdout.write
    // bypasses the print override.
    class TextOnlyWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();
      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        this.listeners.set(type, handler);
      }
      removeEventListener(): void {}
      postMessage(message: Record<string, unknown>): void {
        if (message.type === 'init') {
          this.listeners.get('message')?.({ data: { type: 'ready' } } as MessageEvent);
          return;
        }
        if (message.type === 'execute') {
          const handler = this.listeners.get('message');
          handler?.({
            data: {
              type: 'console',
              runId: message.runId,
              method: 'log',
              args: ['hi'],
              // NOTE: no `payload` key — legacy text-only shape.
            },
          } as MessageEvent);
          handler?.({
            data: { type: 'done', runId: message.runId, executionTime: 1 },
          } as MessageEvent);
        }
      }
      terminate(): void {}
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: TextOnlyWorker,
      writable: true,
      configurable: true,
    });

    const runner = new PythonRunner();
    await runner.init();
    const result = await runner.execute('print("hi")');

    expect(result.stdout).toHaveLength(1);
    const entry = result.stdout[0]!;
    expect(entry.args).toEqual(['hi']);
    expect(entry.payload).toBeUndefined();
  });

  it('maps worker console lines back to original source after loop protection', async () => {
    class LineMappedWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();
      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        this.listeners.set(type, handler);
      }
      removeEventListener(): void {}
      postMessage(message: Record<string, unknown>): void {
        if (message.type === 'init') {
          this.listeners.get('message')?.({ data: { type: 'ready' } } as MessageEvent);
          return;
        }
        if (message.type === 'execute') {
          const handler = this.listeners.get('message');
          handler?.({
            data: {
              type: 'console',
              runId: message.runId,
              method: 'log',
              args: ['after'],
              line: 6,
            },
          } as MessageEvent);
          handler?.({
            data: { type: 'done', runId: message.runId, executionTime: 1 },
          } as MessageEvent);
        }
      }
      terminate(): void {}
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: LineMappedWorker,
      writable: true,
      configurable: true,
    });

    const runner = new PythonRunner();
    await runner.init();
    const result = await runner.execute(
      ['for item in range(1):', '    pass', 'print("after")'].join('\n')
    );

    expect(result.stdout).toHaveLength(1);
    expect(result.stdout[0]?.line).toBe(3);
  });

  it('forwards richConsoleEnabled = true by default to the Pyodide worker', async () => {
    const runner = new PythonRunner();
    await runner.init();
    await runner.execute('print("hi")');
    const executeMessage = postedMessages.find((m) => m.type === 'execute');
    expect(executeMessage?.richConsoleEnabled).toBe(true);
  });

  it('forwards richConsoleEnabled = false when the Settings toggle is OFF', async () => {
    const { useSettingsStore } = await import('@/stores/settingsStore');
    const original = useSettingsStore.getState().consoleRichRenderingEnabled;
    useSettingsStore.setState({ consoleRichRenderingEnabled: false });
    try {
      const runner = new PythonRunner();
      await runner.init();
      await runner.execute('print("hi")');
      const executeMessage = postedMessages.find((m) => m.type === 'execute');
      expect(executeMessage?.richConsoleEnabled).toBe(false);
    } finally {
      useSettingsStore.setState({ consoleRichRenderingEnabled: original });
    }
  });

  it('keeps userEnv empty on the web build even when tiers have values', async () => {
    Object.defineProperty(window, 'lingua', {
      value: { platform: 'web' },
      writable: true,
      configurable: true,
    });
    useEnvVarsStore.setState({
      global: { SHOULD_NOT_LEAK: '1' },
      project: {},
      tab: {},
    });

    const runner = new PythonRunner();
    await runner.init();
    await runner.execute('print("hi")');

    const executeMessage = postedMessages.find((m) => m.type === 'execute');
    expect(executeMessage?.userEnv).toEqual({});
  });

  it('returns a load failure when the Python worker emits a startup error', async () => {
    class FailingWorker {
      private listeners = new Map<string, (event: Event) => void>();

      constructor(_url: URL | string, _options?: WorkerOptions) {}

      addEventListener(type: string, handler: (event: Event) => void): void {
        this.listeners.set(type, handler);
      }

      removeEventListener(type: string): void {
        this.listeners.delete(type);
      }

      postMessage(message: Record<string, unknown>): void {
        postedMessages.push(message);
        if (message.type === 'init') {
          this.listeners.get('error')?.({ message: 'worker script failed' } as Event);
        }
      }

      terminate(): void {
        // no-op for the test
      }
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: FailingWorker,
      writable: true,
      configurable: true,
    });

    const runner = new PythonRunner();
    await runner.init();
    const result = await runner.execute('print("hi")');

    expect(result.error?.message).toContain(
      'Failed to load Python runtime: worker script failed'
    );
  });

  it('can retry after the Python worker reports a Pyodide init error', async () => {
    let workerCount = 0;
    let terminateCount = 0;

    class RecoveringWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();
      private readonly id: number;

      constructor(_url: URL | string, _options?: WorkerOptions) {
        workerCount += 1;
        this.id = workerCount;
      }

      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        this.listeners.set(type, handler);
      }

      removeEventListener(type: string): void {
        this.listeners.delete(type);
      }

      postMessage(message: Record<string, unknown>): void {
        postedMessages.push(message);
        const handler = this.listeners.get('message');
        if (message.type === 'init') {
          handler?.({
            data:
              this.id === 1
                ? { type: 'error', error: { message: 'Pyodide unavailable' } }
                : { type: 'ready' },
          } as MessageEvent);
          return;
        }
        if (message.type === 'execute') {
          handler?.({
            data: {
              type: 'done',
              runId: message.runId,
              executionTime: 1,
            },
          } as MessageEvent);
        }
      }

      terminate(): void {
        terminateCount += 1;
      }
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: RecoveringWorker,
      writable: true,
      configurable: true,
    });

    const runner = new PythonRunner();
    await runner.init();

    const first = await runner.execute('print("hi")');
    const second = await runner.execute('print("hi again")');

    expect(first.error?.message).toContain(
      'Failed to load Python runtime: Pyodide unavailable'
    );
    expect(second.error).toBeUndefined();
    expect(workerCount).toBe(2);
    expect(terminateCount).toBe(1);
  });

  it('resolves as cancelled when stop() is pressed while Pyodide is loading', async () => {
    let terminateCount = 0;
    class HangingWorker {
      constructor(_url: URL | string, _options?: WorkerOptions) {}

      addEventListener(): void {
        // Keep the init request pending until stop() cancels it.
      }

      removeEventListener(): void {
        // no-op for the test
      }

      postMessage(message: Record<string, unknown>): void {
        postedMessages.push(message);
      }

      terminate(): void {
        terminateCount += 1;
      }
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: HangingWorker,
      writable: true,
      configurable: true,
    });

    const runner = new PythonRunner();
    await runner.init();
    const promise = runner.execute('print("hi")');
    await Promise.resolve();
    runner.stop();

    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(result.error?.message).toBe('Execution stopped by user.');
    expect(terminateCount).toBe(1);
  });
});
