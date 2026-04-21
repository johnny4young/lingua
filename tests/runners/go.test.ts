import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock window.lingua for IPC calls
const mockDetect = vi.fn();
const mockCompile = vi.fn();

Object.defineProperty(globalThis, 'window', {
  value: {
    ...globalThis.window,
    lingua: {
      platform: 'darwin',
      go: {
        detect: mockDetect,
        compile: mockCompile,
      },
    },
  },
  writable: true,
});

import { GoRunner } from '@/runners/go';
import { useEnvVarsStore } from '@/stores/envVarsStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';

describe('GoRunner', () => {
  const initialEnv = useEnvVarsStore.getState();
  const initialEditor = useEditorStore.getState();
  const initialProject = useProjectStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    useEnvVarsStore.setState(initialEnv, true);
    useEditorStore.setState(initialEditor, true);
    useProjectStore.setState(initialProject, true);
  });

  it('should have correct metadata', () => {
    const runner = new GoRunner();
    expect(runner.id).toBe('go');
    expect(runner.name).toBe('Go');
    expect(runner.language).toBe('go');
    expect(runner.extensions).toContain('.go');
  });

  it('should not be ready before init', () => {
    const runner = new GoRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('should be ready after init when Go is installed', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' });
    const runner = new GoRunner();
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('should throw on init when Go is not installed', async () => {
    mockDetect.mockResolvedValue({ installed: false, error: 'Go is not installed' });
    const runner = new GoRunner();
    await expect(runner.init()).rejects.toThrow('Go is not installed');
    expect(runner.isReady()).toBe(true); // ready is set even if not installed
  });

  it('should return error result when Go is not installed and execute is called', async () => {
    mockDetect.mockResolvedValue({ installed: false, error: 'Go is not installed' });
    const runner = new GoRunner();
    try {
      await runner.init();
    } catch {
      // expected
    }
    const result = await runner.execute('package main\nfunc main() {}');
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Go is not installed');
    expect(result.executionTime).toBe(0);
  });

  it('should return error result when compilation fails', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' });
    mockCompile.mockResolvedValue({
      success: false,
      error: './main.go:3:5: undefined: fmt',
    });

    const runner = new GoRunner();
    await runner.init();
    const result = await runner.execute('package main\nfunc main() { fmt.Println("hi") }');

    expect(result.error).toBeDefined();
    expect(result.error).toMatchObject({
      message: 'undefined: fmt',
      line: 3,
      column: 5,
    });
  });

  it('should use a classic worker for Go WASM execution', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' });
    mockCompile.mockResolvedValue({
      success: true,
      wasmBytes: [0],
      wasmExecJs: 'self.Go = class { constructor() { this.importObject = {}; } async run() {} }; self.fs = { writeSync() { return 0; } };',
    });

    const originalWorker = globalThis.Worker;
    const createdOptions: WorkerOptions[] = [];

    class MockWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();

      constructor(_url: URL | string, options?: WorkerOptions) {
        createdOptions.push(options ?? {});
      }

      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        this.listeners.set(type, handler);
      }

      postMessage(): void {
        const handler = this.listeners.get('message');
        handler?.({ data: { type: 'done', executionTime: 1 } } as MessageEvent);
      }

      terminate(): void {}
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: MockWorker,
      writable: true,
      configurable: true,
    });

    try {
      const runner = new GoRunner();
      await runner.init();
      const result = await runner.execute('package main\nfunc main() {}');

      expect(createdOptions).toEqual([{ type: 'classic' }]);
      expect(result.error).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        writable: true,
        configurable: true,
      });
    }
  });

  it('should stop without error when no worker is running', () => {
    const runner = new GoRunner();
    expect(() => runner.stop()).not.toThrow();
  });

  it('should call detect on init', async () => {
    mockDetect.mockResolvedValue({ installed: true, version: 'go1.22.0', goRoot: '/usr/local/go' });
    const runner = new GoRunner();
    await runner.init();
    expect(mockDetect).toHaveBeenCalledOnce();
  });

  it('RL-011 Slice D — forwards the merged user env (global + project + tab) to go:compile', async () => {
    mockDetect.mockResolvedValue({
      installed: true,
      version: 'go1.22.0',
      goRoot: '/usr/local/go',
    });
    mockCompile.mockResolvedValue({ success: false, error: 'mock' });

    // Seed the renderer stores with user-space env across three tiers
    // so the runner must compose all of them through the Slice A
    // merger before firing the IPC.
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
          name: 'main.go',
          language: 'go',
          content: '',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-1',
    });

    const runner = new GoRunner();
    await runner.init();
    await runner.execute('package main\nfunc main() {}');

    expect(mockCompile).toHaveBeenCalledTimes(1);
    const [sourceCode, userEnv] = mockCompile.mock.calls[0] as [string, Record<string, string>];
    expect(sourceCode).toContain('package main');
    // Tab wins over project + global for SHARED; tier-unique keys survive.
    expect(userEnv).toMatchObject({
      SHARED: 'from-tab',
      GLOBAL_ONLY: 'g',
      PROJECT_ONLY: 'p',
      TAB_ONLY: 't',
    });
  });

  it('RL-011 Slice D — forwards an empty env when no tiers have values', async () => {
    mockDetect.mockResolvedValue({
      installed: true,
      version: 'go1.22.0',
      goRoot: '/usr/local/go',
    });
    mockCompile.mockResolvedValue({ success: false, error: 'mock' });

    const runner = new GoRunner();
    await runner.init();
    await runner.execute('package main\nfunc main() {}');

    const [, userEnv] = mockCompile.mock.calls[0] as [string, Record<string, string>];
    expect(userEnv).toEqual({});
  });
});
