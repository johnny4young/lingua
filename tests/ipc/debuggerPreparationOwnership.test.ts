import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  resolveCapabilityPath: vi.fn(),
  resolveDelveBinary: vi.fn(async () => null),
  resolveRustCompiler: vi.fn(async () => null),
  resolveLldbDapBinary: vi.fn(async () => null),
  goSession: vi.fn(),
  rustSession: vi.fn(),
  pythonSession: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));
vi.mock('../../src/main/ipc/projectCapabilities', () => ({
  resolveCapabilityPath: mocks.resolveCapabilityPath,
}));
vi.mock('../../src/main/goDebugger', () => ({
  GoDebugSession: mocks.goSession,
  resolveDelveBinary: mocks.resolveDelveBinary,
}));
vi.mock('../../src/main/rustDebugger', () => ({
  RustDebugSession: mocks.rustSession,
  resolveRustCompiler: mocks.resolveRustCompiler,
  resolveLldbDapBinary: mocks.resolveLldbDapBinary,
}));
vi.mock('../../src/main/pythonDebugger', () => ({
  PythonDebugSession: mocks.pythonSession,
  parsePdbStack: vi.fn(() => []),
}));

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  return {
    promise: new Promise<T>((done, fail) => { resolve = done; reject = fail; }),
    resolve,
    reject,
  };
}

function sender(id: number) {
  const destroyed = new Set<() => void>();
  return {
    id,
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyed.add(listener);
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyed.delete(listener);
    }),
    destroy: () => {
      for (const listener of [...destroyed]) listener();
    },
  };
}

const requests = {
  python: {
    tabId: 'python-tab', sessionId: 'python-preparing', fileName: 'main.py',
    source: 'print(1)\n', breakpoints: [1], watches: [],
    rootId: 'root-python', relativePath: 'main.py', userEnv: { PATH: '/missing' },
  },
  go: {
    tabId: 'go-tab', sessionId: 'go-preparing', fileName: 'main.go',
    source: 'package main\nfunc main() {}\n', breakpoints: [2], watches: [],
    rootId: 'root-go', relativePath: 'main.go',
  },
  rust: {
    tabId: 'rust-tab', sessionId: 'rust-preparing', fileName: 'main.rs',
    source: 'fn main() {}\n', breakpoints: [1], watches: [],
    rootId: 'root-rust', relativePath: 'main.rs',
  },
} as const;

type Runtime = keyof typeof requests;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.handlers.clear();
  const [python, go, rust] = await Promise.all([
    import('../../src/main/ipc/pythonDebugger'),
    import('../../src/main/ipc/goDebugger'),
    import('../../src/main/ipc/rustDebugger'),
  ]);
  python.registerPythonDebuggerHandlers();
  go.registerGoDebuggerHandlers();
  rust.registerRustDebuggerHandlers();
});

afterEach(async () => {
  const [python, go, rust] = await Promise.all([
    import('../../src/main/ipc/pythonDebugger'),
    import('../../src/main/ipc/goDebugger'),
    import('../../src/main/ipc/rustDebugger'),
  ]);
  python.disposePythonDebuggerSessions();
  go.disposeGoDebuggerSessions();
  rust.disposeRustDebuggerSessions();
});

function approve(runtime: Runtime) {
  return {
    ok: true as const,
    absolutePath: `/tmp/lingua-debug-${runtime}/main.${runtime === 'python' ? 'py' : runtime === 'go' ? 'go' : 'rs'}`,
  };
}

describe('native debugger preparation ownership', () => {
  it.each(['python', 'go', 'rust'] as const)(
    'Stop owns %s before capability authorization resolves',
    async runtime => {
      const authorization = deferred<ReturnType<typeof approve>>();
      mocks.resolveCapabilityPath.mockReturnValueOnce(authorization.promise);
      const owner = sender(100);
      const start = mocks.handlers.get(`debugger:${runtime}:start`)!;
      const stop = mocks.handlers.get(`debugger:${runtime}:stop`)!;
      const started = Promise.resolve(start({ sender: owner }, requests[runtime]));
      await vi.waitFor(() => expect(mocks.resolveCapabilityPath).toHaveBeenCalledTimes(1));

      const stopped = await stop({ sender: owner }, requests[runtime].sessionId);
      authorization.resolve(approve(runtime));
      const result = await started;

      expect(stopped).toEqual({ kind: 'stopped', sessionId: requests[runtime].sessionId });
      expect(result).toEqual({ kind: 'stopped', sessionId: requests[runtime].sessionId });
      if (runtime === 'go') expect(mocks.resolveDelveBinary).not.toHaveBeenCalled();
      if (runtime === 'rust') expect(mocks.resolveRustCompiler).not.toHaveBeenCalled();
    }
  );

  it('owner loss cancels Go before authorization can resume preparation', async () => {
    const authorization = deferred<ReturnType<typeof approve>>();
    mocks.resolveCapabilityPath.mockReturnValueOnce(authorization.promise);
    const owner = sender(200);
    const start = mocks.handlers.get('debugger:go:start')!;
    const started = Promise.resolve(start({ sender: owner }, requests.go));
    await vi.waitFor(() => expect(mocks.resolveCapabilityPath).toHaveBeenCalledTimes(1));

    owner.destroy();
    authorization.resolve(approve('go'));

    await expect(started).resolves.toEqual({ kind: 'stopped', sessionId: requests.go.sessionId });
    expect(mocks.resolveDelveBinary).not.toHaveBeenCalled();
  });

  it('shutdown cancels Rust before authorization can resume preparation', async () => {
    const authorization = deferred<ReturnType<typeof approve>>();
    mocks.resolveCapabilityPath.mockReturnValueOnce(authorization.promise);
    const owner = sender(300);
    const start = mocks.handlers.get('debugger:rust:start')!;
    const started = Promise.resolve(start({ sender: owner }, requests.rust));
    await vi.waitFor(() => expect(mocks.resolveCapabilityPath).toHaveBeenCalledTimes(1));

    const { disposeRustDebuggerSessions } = await import('../../src/main/ipc/rustDebugger');
    disposeRustDebuggerSessions();
    authorization.resolve(approve('rust'));

    await expect(started).resolves.toEqual({ kind: 'stopped', sessionId: requests.rust.sessionId });
    expect(mocks.resolveRustCompiler).not.toHaveBeenCalled();
  });

  it('rejects a duplicate preparation identity without authorizing twice', async () => {
    const approvals: Array<Deferred<ReturnType<typeof approve>>> = [];
    mocks.resolveCapabilityPath.mockImplementation(() => {
      const authorization = deferred<ReturnType<typeof approve>>();
      approvals.push(authorization);
      return authorization.promise;
    });
    const owner = sender(400);
    const start = mocks.handlers.get('debugger:go:start')!;
    const stop = mocks.handlers.get('debugger:go:stop')!;
    const first = Promise.resolve(start({ sender: owner }, requests.go));
    await vi.waitFor(() => expect(approvals.length).toBe(1));
    const duplicate = Promise.resolve(start({ sender: owner }, requests.go));
    await Promise.resolve();

    const stopped = await stop({ sender: owner }, requests.go.sessionId);
    for (const authorization of approvals) authorization.resolve(approve('go'));
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

    expect(mocks.resolveCapabilityPath).toHaveBeenCalledTimes(1);
    expect(duplicateResult).toEqual({ kind: 'error', reason: 'invalid-request' });
    expect(stopped).toEqual({ kind: 'stopped', sessionId: requests.go.sessionId });
    expect(firstResult).toEqual({ kind: 'stopped', sessionId: requests.go.sessionId });
  });

  it('does not let another owner stop a pending preparation', async () => {
    const authorization = deferred<ReturnType<typeof approve>>();
    mocks.resolveCapabilityPath.mockReturnValueOnce(authorization.promise);
    const owner = sender(500);
    const start = mocks.handlers.get('debugger:python:start')!;
    const stop = mocks.handlers.get('debugger:python:stop')!;
    const started = Promise.resolve(start({ sender: owner }, requests.python));
    await vi.waitFor(() => expect(mocks.resolveCapabilityPath).toHaveBeenCalledTimes(1));

    await expect(stop({ sender: sender(501) }, requests.python.sessionId)).resolves.toEqual({
      kind: 'error', reason: 'session-not-found',
    });
    await expect(stop({ sender: owner }, requests.python.sessionId)).resolves.toEqual({
      kind: 'stopped', sessionId: requests.python.sessionId,
    });
    authorization.resolve(approve('python'));
    await expect(started).resolves.toEqual({
      kind: 'stopped', sessionId: requests.python.sessionId,
    });
  });

  it('rejects malformed preparation identities before authorization', async () => {
    const start = mocks.handlers.get('debugger:rust:start')!;

    await expect(start({ sender: sender(600) }, {
      ...requests.rust,
      sessionId: '../not-an-identity',
    })).resolves.toEqual({ kind: 'error', reason: 'invalid-request' });
    expect(mocks.resolveCapabilityPath).not.toHaveBeenCalled();
  });

  it('keeps a replacement with the same identity when the stopped start rejects late', async () => {
    const firstStart = deferred<unknown>();
    const replacementStart = deferred<unknown>();
    const firstSession = {
      start: vi.fn(() => firstStart.promise),
      terminate: vi.fn(),
      drainOutput: vi.fn(() => ({ output: '', outputTruncated: false })),
    };
    const replacementSession = {
      start: vi.fn(() => replacementStart.promise),
      terminate: vi.fn(),
      drainOutput: vi.fn(() => ({ output: '', outputTruncated: false })),
    };
    mocks.resolveCapabilityPath.mockResolvedValue(approve('go'));
    mocks.resolveDelveBinary.mockResolvedValue({ command: 'dlv', version: 'fixture' });
    mocks.goSession
      .mockImplementationOnce(function () { return firstSession; })
      .mockImplementationOnce(function () { return replacementSession; });
    const owner = sender(700);
    const start = mocks.handlers.get('debugger:go:start')!;
    const stop = mocks.handlers.get('debugger:go:stop')!;

    const first = Promise.resolve(start({ sender: owner }, requests.go));
    await vi.waitFor(() => expect(firstSession.start).toHaveBeenCalledTimes(1));
    await expect(stop({ sender: owner }, requests.go.sessionId)).resolves.toEqual({
      kind: 'stopped', sessionId: requests.go.sessionId,
    });
    const replacement = Promise.resolve(start({ sender: owner }, requests.go));
    await vi.waitFor(() => expect(replacementSession.start).toHaveBeenCalledTimes(1));

    firstStart.reject(new Error('late stopped start'));
    await expect(first).resolves.toEqual({ kind: 'stopped', sessionId: requests.go.sessionId });
    await expect(stop({ sender: owner }, requests.go.sessionId)).resolves.toEqual({
      kind: 'stopped', sessionId: requests.go.sessionId,
    });
    replacementStart.reject(new Error('replacement stopped'));
    await expect(replacement).resolves.toEqual({
      kind: 'stopped', sessionId: requests.go.sessionId,
    });
    expect(replacementSession.terminate).toHaveBeenCalled();
  });
});
