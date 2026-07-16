import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RubyRunner } from '@/runners/ruby';
import { useUIStore } from '@/stores/uiStore';

describe('RubyRunner — metadata + lifecycle', () => {
  it('exposes the expected metadata (hybrid dispatcher)', () => {
    const runner = new RubyRunner();
    expect(runner.id).toBe('ruby');
    // RL-042 Slice 6 — the public RubyRunner is now a dispatcher
    // that picks WASM vs desktop subprocess per call. Its `name`
    // reads as the generic "Ruby"; the inner WasmRubyRunner /
    // DesktopRubySubprocessRunner keep their specific labels.
    expect(runner.name).toBe('Ruby');
    expect(runner.language).toBe('ruby');
    expect(runner.extensions).toContain('.rb');
  });

  it('is not ready before init', () => {
    const runner = new RubyRunner();
    expect(runner.isReady()).toBe(false);
  });

  it('is ready after init (Ruby VM loads lazily on first execute)', async () => {
    const runner = new RubyRunner();
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('stop() is safe to call when no worker is running', () => {
    const runner = new RubyRunner();
    expect(() => runner.stop()).not.toThrow();
  });

  it('stop() leaves the runner in a state that accepts another stop()', async () => {
    const runner = new RubyRunner();
    await runner.init();
    runner.stop();
    expect(() => runner.stop()).not.toThrow();
  });
});

describe('RubyRunner — worker dispatch (happy path)', () => {
  let originalWorker: typeof globalThis.Worker;
  let postedMessages: Array<Record<string, unknown>>;
  let terminateCount: number;

  class HappyPathWorker {
    private listeners = new Map<string, (event: MessageEvent) => void>();

    constructor(_url: URL | string, _options?: WorkerOptions) {}

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
        handler?.({ data: { type: 'ready' } } as MessageEvent);
        return;
      }
      if (message.type === 'execute') {
        const runId = message.runId as string;
        handler?.({
          data: {
            type: 'console',
            runId,
            method: 'log',
            args: ['Hello, Ruby!'],
          },
        } as MessageEvent);
        handler?.({
          data: {
            type: 'console',
            runId,
            method: 'log',
            args: ['sum 1..10 = 55'],
          },
        } as MessageEvent);
        handler?.({
          data: { type: 'done', runId, executionTime: 42 },
        } as MessageEvent);
      }
    }

    terminate(): void {
      terminateCount += 1;
    }
  }

  beforeEach(() => {
    postedMessages = [];
    terminateCount = 0;
    originalWorker = globalThis.Worker;
    Object.defineProperty(globalThis, 'Worker', {
      value: HappyPathWorker,
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
    vi.restoreAllMocks();
  });

  it('captures console output and resolves with stdout entries', async () => {
    const runner = new RubyRunner();
    await runner.init();
    const result = await runner.execute('puts "Hello, Ruby!"');

    expect(result.stdout).toHaveLength(2);
    expect(result.stdout[0]?.type).toBe('log');
    expect(result.stdout[0]?.args).toEqual(['Hello, Ruby!']);
    expect(result.stdout[1]?.args).toEqual(['sum 1..10 = 55']);
    expect(result.error).toBeUndefined();
    expect(result.kind).toBe('success');
    expect(result.executionTime).toBe(42);
  });

  it('posts an execute message carrying the user code + a runId', async () => {
    const runner = new RubyRunner();
    await runner.init();
    await runner.execute('puts "hi"');

    const executeMessage = postedMessages.find((m) => m.type === 'execute');
    expect(executeMessage).toBeDefined();
    expect(executeMessage?.code).toBe('puts "hi"');
    expect(executeMessage?.runId).toEqual(expect.any(String));
  });

  it('reuses the persistent worker across runs (single terminate only on stop)', async () => {
    const runner = new RubyRunner();
    await runner.init();
    await runner.execute('puts "first"');
    await runner.execute('puts "second"');
    expect(terminateCount).toBe(0);
    runner.stop();
    expect(terminateCount).toBe(1);
  });
});

describe('RubyRunner — error path', () => {
  let originalWorker: typeof globalThis.Worker;

  class ErrorWorker {
    private listeners = new Map<string, (event: MessageEvent) => void>();

    constructor(_url: URL | string, _options?: WorkerOptions) {}

    addEventListener(type: string, handler: (event: MessageEvent) => void): void {
      this.listeners.set(type, handler);
    }

    removeEventListener(): void {}

    postMessage(message: Record<string, unknown>): void {
      const handler = this.listeners.get('message');
      if (message.type === 'init') {
        handler?.({ data: { type: 'ready' } } as MessageEvent);
        return;
      }
      if (message.type === 'execute') {
        const runId = message.runId as string;
        handler?.({
          data: {
            type: 'console',
            runId,
            method: 'warn',
            args: ['ruby-err'],
          },
        } as MessageEvent);
        // Stderr traceback line (the worker emits each line as a
        // separate console entry to mirror Python's behavior).
        handler?.({
          data: {
            type: 'console',
            runId,
            method: 'error',
            args: ['(eval):1:in `<main>'],
            line: 1,
          },
        } as MessageEvent);
        handler?.({
          data: {
            type: 'console',
            runId,
            method: 'error',
            args: ['boom (RuntimeError)'],
            line: 1,
          },
        } as MessageEvent);
        handler?.({
          data: {
            type: 'error',
            runId,
            error: { message: 'boom (RuntimeError)', line: 1 },
          },
        } as MessageEvent);
        handler?.({
          data: { type: 'done', runId, executionTime: 12 },
        } as MessageEvent);
      }
    }

    terminate(): void {}
  }

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    Object.defineProperty(globalThis, 'Worker', {
      value: ErrorWorker,
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
  });

  it('surfaces Ruby errors with line annotation and marks kind === error', async () => {
    const runner = new RubyRunner();
    await runner.init();
    const result = await runner.execute('raise "boom"');

    expect(result.stderr).toHaveLength(3);
    expect(result.stderr[0]).toEqual({ type: 'warn', args: ['ruby-err'] });
    expect(result.stderr[1]?.line).toBe(1);
    expect(result.stderr[2]?.args[0]).toContain('RuntimeError');
    expect(result.error?.message).toContain('boom');
    expect(result.error?.line).toBe(1);
    expect(result.kind).toBe('error');
  });
});

describe('RubyRunner — load failure + timeout', () => {
  let originalWorker: typeof globalThis.Worker;

  class FailingWorker {
    private listeners = new Map<string, (event: Event) => void>();

    constructor(_url: URL | string, _options?: WorkerOptions) {}

    addEventListener(type: string, handler: (event: Event) => void): void {
      this.listeners.set(type, handler);
    }

    removeEventListener(): void {}

    postMessage(message: Record<string, unknown>): void {
      if (message.type === 'init') {
        // Simulate the @ruby/wasm-wasi fetch path blowing up.
        this.listeners.get('error')?.({ message: 'ruby wasm fetch failed' } as Event);
      }
    }

    terminate(): void {}
  }

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    Object.defineProperty(globalThis, 'Worker', {
      value: FailingWorker,
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
  });

  it('returns a load failure when the Ruby worker errors during boot', async () => {
    const runner = new RubyRunner();
    await runner.init();
    const result = await runner.execute('puts "hi"');
    expect(result.error?.message).toContain(
      'Failed to load Ruby runtime: ruby wasm fetch failed'
    );
    expect(result.kind).toBe('error');
    // The early-return load-failure branch constructs stdout/stderr
    // inline as empty arrays rather than draining buffered output.
    // Asserting the shape protects against a refactor that
    // accidentally leaks pre-failure chatter.
    expect(result.stdout).toHaveLength(0);
    expect(result.stderr).toHaveLength(0);
  });
});

describe('RubyRunner — parent-owned timeout', () => {
  let originalWorker: typeof globalThis.Worker;
  let terminateCount: number;

  class HangingWorker {
    private listeners = new Map<string, (event: MessageEvent) => void>();

    constructor(_url: URL | string, _options?: WorkerOptions) {}

    addEventListener(type: string, handler: (event: MessageEvent) => void): void {
      this.listeners.set(type, handler);
    }

    removeEventListener(): void {}

    postMessage(message: Record<string, unknown>): void {
      const handler = this.listeners.get('message');
      if (message.type === 'init') {
        handler?.({ data: { type: 'ready' } } as MessageEvent);
        return;
      }
      // For execute: never reply. The parent timer is the only way out.
    }

    terminate(): void {
      terminateCount += 1;
    }
  }

  beforeEach(() => {
    terminateCount = 0;
    originalWorker = globalThis.Worker;
    Object.defineProperty(globalThis, 'Worker', {
      value: HangingWorker,
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
  });

  it('terminates the worker and resolves with timeoutResult when execution hangs', async () => {
    const runner = new RubyRunner();
    await runner.init();
    // 10ms is plenty for the parent timer to fire; the test stays
    // bounded without waking real-world fake timers.
    const result = await runner.execute('loop { }', { timeout: 10 });
    expect(terminateCount).toBeGreaterThanOrEqual(1);
    expect(result.kind).toBe('timeout');
    expect(result.timeoutMs).toBe(10);
  });
});

// ----------------------------------------------------------------------
// RL-042 Slice 6 — hybrid dispatcher routing
// ----------------------------------------------------------------------

describe('RubyRunner — desktop dispatcher routing', () => {
  let originalLingua: unknown;
  let originalWorker: typeof globalThis.Worker;
  let bridgeRun: ReturnType<typeof vi.fn>;
  let bridgeDetect: ReturnType<typeof vi.fn>;
  let bridgeStop: ReturnType<typeof vi.fn>;

  // The WASM path needs a Worker constructor that immediately replies
  // 'ready' so the dispatcher's ensureRuby() resolves quickly; then
  // the per-execute parent timer (5 ms in these tests) fires and
  // closes out the run as 'timeout'. Without the prompt 'ready' the
  // WASM loader hangs for 90 s (its own bootstrap timeout) and the
  // vitest default deadline trips first.
  class IdleWorker {
    private listeners = new Map<string, (event: MessageEvent) => void>();
    addEventListener(type: string, handler: (event: MessageEvent) => void): void {
      this.listeners.set(type, handler);
    }
    removeEventListener(type: string): void {
      this.listeners.delete(type);
    }
    postMessage(message: Record<string, unknown>): void {
      if (message.type === 'init') {
        // Fire `ready` synchronously so `ensureRuby()` resolves before
        // the parent execute timer arms.
        this.listeners.get('message')?.({
          data: { type: 'ready' },
        } as MessageEvent);
      }
      // Never reply to execute — let the per-execute timeout decide.
    }
    terminate(): void {}
  }

  beforeEach(async () => {
    originalLingua = (window as Window & { lingua?: unknown }).lingua;
    originalWorker = globalThis.Worker;
    Object.defineProperty(globalThis, 'Worker', {
      value: IdleWorker,
      writable: true,
      configurable: true,
    });

    bridgeDetect = vi.fn().mockResolvedValue({
      installed: true,
      version: 'ruby 3.3.6 (2024-11-05 revision 75015a4f5e) [arm64-darwin23]',
      semver: '3.3.6',
      platform: 'arm64-darwin23',
    });
    bridgeRun = vi.fn().mockResolvedValue({
      kind: 'success',
      stdout: 'Hello, Ruby (system)!\n',
      stderr: '',
      exitCode: 0,
      executionTime: 42,
      timeoutMs: 30_000,
    });
    bridgeStop = vi.fn().mockResolvedValue({ stopped: true });

    Object.defineProperty(window, 'lingua', {
      value: {
        platform: 'darwin',
        ruby: { detect: bridgeDetect, run: bridgeRun, stop: bridgeStop },
      },
      writable: true,
      configurable: true,
    });

    // Reset persistent settings between tests.
    const { useSettingsStore } = await import(
      '../../src/renderer/stores/settingsStore'
    );
    useSettingsStore.setState({ rubyRuntimePreference: 'auto' });
    useUIStore.setState({ statusNotice: null });
  });

  afterEach(() => {
    Object.defineProperty(window, 'lingua', {
      value: originalLingua,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'Worker', {
      value: originalWorker,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('dispatches to the desktop bridge when preference is auto and ruby is detected', async () => {
    const runner = new RubyRunner();
    await runner.init();
    const result = await runner.execute('puts "hi"');

    expect(bridgeDetect).toHaveBeenCalled();
    expect(bridgeRun).toHaveBeenCalledTimes(1);
    expect(bridgeRun.mock.calls[0]?.[0]).toBe('puts "hi"');
    expect(result.kind).toBe('success');
    expect(result.stdout).toHaveLength(1);
    expect(result.stdout[0]?.args).toEqual(['Hello, Ruby (system)!']);
  });

  it('forces the desktop bridge when preference is system', async () => {
    const { useSettingsStore } = await import(
      '../../src/renderer/stores/settingsStore'
    );
    useSettingsStore.setState({ rubyRuntimePreference: 'system' });
    const runner = new RubyRunner();
    await runner.init();
    await runner.execute('puts "system"');
    expect(bridgeRun).toHaveBeenCalledTimes(1);
  });

  it('falls back to WASM when preference is system but ruby is missing', async () => {
    bridgeDetect.mockResolvedValueOnce({
      installed: false,
      error: 'not found',
    });
    const { useSettingsStore } = await import(
      '../../src/renderer/stores/settingsStore'
    );
    useSettingsStore.setState({ rubyRuntimePreference: 'system' });
    const runner = new RubyRunner();
    await runner.init();
    // The WASM worker is the IdleWorker mock — execute() will hang
    // waiting for `ready`. Drop a short timeout so the test resolves.
    const promise = runner.execute('puts "wasm fallback"', { timeout: 5 });
    const result = await promise;
    // We don't care about the WASM result kind here; we only assert
    // the desktop bridge was NEVER invoked because detect returned
    // missing.
    expect(bridgeRun).not.toHaveBeenCalled();
    expect(result.kind).toBe('timeout');
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'warning',
      values: { toolchain: 'Ruby' },
    });
  });

  it('uses WASM when preference is wasm even if ruby is detected', async () => {
    const { useSettingsStore } = await import(
      '../../src/renderer/stores/settingsStore'
    );
    useSettingsStore.setState({ rubyRuntimePreference: 'wasm' });
    const runner = new RubyRunner();
    await runner.init();
    const promise = runner.execute('puts "wasm-only"', { timeout: 5 });
    const result = await promise;
    expect(bridgeRun).not.toHaveBeenCalled();
    expect(result.kind).toBe('timeout');
  });

  it('routes stop() to the desktop bridge while a run is in flight', async () => {
    // Replace the resolving bridge.run mock with one that never
    // resolves so stop() can fire against an in-flight runId. The
    // dispatcher's stop() only calls bridge.stop while `currentRunId`
    // is set (between the start and the natural close).
    let resolveRun: ((value: RubyRunResult) => void) | undefined;
    bridgeRun.mockImplementationOnce(
      () =>
        new Promise<RubyRunResult>((resolve) => {
          resolveRun = resolve;
        })
    );

    const runner = new RubyRunner();
    await runner.init();
    const runPromise = runner.execute('sleep 30');
    // Yield to microtasks so the dispatcher reaches the bridge.run
    // call and assigns currentRunId.
    await new Promise((resolve) => setImmediate(resolve));

    runner.stop();
    expect(bridgeStop).toHaveBeenCalledTimes(1);
    expect(bridgeStop.mock.calls[0]?.[0]).toEqual(expect.any(String));

    // Resolve the pending bridge.run so the runPromise settles and
    // the test exits cleanly.
    resolveRun?.({
      kind: 'stopped',
      stdout: '',
      stderr: '',
      exitCode: -1,
      executionTime: 5,
      timeoutMs: 30_000,
    });
    const result = await runPromise;
    expect(result.kind).toBe('stopped');
  });
});
