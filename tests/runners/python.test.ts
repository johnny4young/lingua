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
        handler?.({ data: { type: 'done', executionTime: 1 } } as MessageEvent);
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
});
