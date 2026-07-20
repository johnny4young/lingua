import { vi, describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Stub Worker globals so importing the module doesn't throw
// ---------------------------------------------------------------------------

vi.stubGlobal('self', {
  addEventListener: vi.fn(),
  postMessage: vi.fn(),
});

// The worker file only exports `{}` (to make it a module).
// All helpers (serialize, parseError, etc.) are module-private.
// We document the worker message protocol with lightweight assertions
// and verify the module can be imported without crashing.

// ---------------------------------------------------------------------------
// Protocol documentation tests
// ---------------------------------------------------------------------------

async function executeJsWorkerCode(
  code: string,
  options: { captureStructuredResult?: boolean } = {}
): Promise<Array<Record<string, unknown>>> {
  vi.resetModules();
  const messages: Array<Record<string, unknown>> = [];
  let messageHandler:
    | ((event: { data: unknown }) => void | Promise<void>)
    | null = null;

  vi.stubGlobal('self', {
    addEventListener: vi.fn(
      (
        type: string,
        handler: (event: { data: unknown }) => void | Promise<void>
      ) => {
        if (type === 'message') {
          messageHandler = handler;
        }
      }
    ),
    postMessage: vi.fn((message: Record<string, unknown>) => {
      messages.push(message);
    }),
  });

  await import('@/workers/js-worker');
  expect(messageHandler).not.toBeNull();

  await messageHandler!({
    data: {
      type: 'execute',
      runId: 'run-1',
      code,
      resultTruncationMarker: '[result truncated]',
      captureStructuredResult: options.captureStructuredResult,
    },
  });

  return messages;
}

describe('js-worker module', () => {
  it('can be imported without throwing', async () => {
    // If this import throws, the stub above is incomplete
    await expect(import('@/workers/js-worker')).resolves.toBeDefined();
  });

  it('exports an empty object (module boundary marker)', async () => {
    const mod = await import('@/workers/js-worker');
    // The file has `export {};` – the module object should be empty
    expect(Object.keys(mod)).toHaveLength(0);
  });

  it('console.table consumes the optional columns arg in both payload and text fallback', async () => {
    vi.resetModules();
    const messages: Array<Record<string, unknown>> = [];
    let messageHandler:
      | ((event: { data: unknown }) => void | Promise<void>)
      | null = null;

    vi.stubGlobal('self', {
      addEventListener: vi.fn(
        (
          type: string,
          handler: (event: { data: unknown }) => void | Promise<void>
        ) => {
          if (type === 'message') {
            messageHandler = handler;
          }
        }
      ),
      postMessage: vi.fn((message: Record<string, unknown>) => {
        messages.push(message);
      }),
    });

    await import('@/workers/js-worker');
    expect(messageHandler).not.toBeNull();

    await messageHandler!({
      data: {
        type: 'execute',
        runId: 'run-1',
        code: 'console.table([{ name: "alice", age: 30 }], ["age"])',
        resultTruncationMarker: '[result truncated]',
      },
    });

    const consoleMessage = messages.find((message) => message.type === 'console');
    expect(consoleMessage).toMatchObject({
      runId: 'run-1',
      method: 'log',
      args: ['Table(1×1)'],
      consoleTableInvoked: true,
    });
    const payload = consoleMessage?.payload as Array<{
      kind: string;
      columns: string[];
      rows: unknown[][];
    }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      kind: 'table',
      columns: ['age'],
    });
    expect(payload[0]?.rows[0]).toHaveLength(1);
    expect(messages.some((message) => message.type === 'done')).toBe(true);
  });

  it('posts typed image and html payloads through the lingua bridge', async () => {
    const messages = await executeJsWorkerCode(`
      lingua.image({ src: 'data:image/png;base64,a', mime: 'image/png' });
      lingua.html('<strong>ok</strong>');
    `);

    const consoleMessages = messages.filter((message) => message.type === 'console');
    expect(consoleMessages).toHaveLength(2);
    expect(consoleMessages[0]).toMatchObject({
      method: 'log',
      args: ['[image image/png]'],
      payload: [{ kind: 'image', src: 'data:image/png;base64,a', mime: 'image/png' }],
    });
    expect(consoleMessages[1]).toMatchObject({
      method: 'log',
      args: ['[html sandboxed]'],
      payload: [{ kind: 'html', html: '<strong>ok</strong>' }],
    });
  });

  it('marks rejected chart specs from the lingua bridge', async () => {
    const messages = await executeJsWorkerCode(`
      lingua.chart({
        mark: 'bar',
        layer: [{ data: { url: 'https://example.com/data.csv' }, mark: 'point' }]
      });
    `);

    const consoleMessage = messages.find((message) => message.type === 'console');
    // implementation prerequisite fix — the rejection text now
    // explains the cause (anti-feature §A-008: no silent network).
    // Match a substring so future copy refinements don't break this
    // contract test while the diagnostic clause stays meaningful.
    expect(consoleMessage).toMatchObject({
      method: 'log',
      richMediaRejected: { kind: 'chart', reason: 'validation-failed' },
    });
    const args = consoleMessage?.args as unknown[] | undefined;
    expect(typeof args?.[0]).toBe('string');
    expect(args?.[0]).toContain('chart');
    expect(args?.[0]).toContain('data.values');
    expect(consoleMessage?.payload).toBeUndefined();
  });

  it('attaches structured frames to thrown execution errors', async () => {
    const messages = await executeJsWorkerCode(`
      function boom() {
        throw new Error('bridge-boom');
      }
      boom();
    `);

    const errorMessage = messages.find((message) => message.type === 'error') as
      | { error?: { message?: string; frames?: unknown[] } }
      | undefined;
    expect(errorMessage?.error?.message).toBe('bridge-boom');
    expect(errorMessage?.error?.frames?.length).toBeGreaterThan(0);
    expect(errorMessage?.error?.frames?.some((frame) => {
      return Boolean(
        frame &&
          typeof frame === 'object' &&
          'file' in frame &&
          'line' in frame
      );
    })).toBe(true);
  });

  it('keeps structured-result serializable siblings beside function and bigint leaves', async () => {
    const messages = await executeJsWorkerCode(
      `
        return {
          stdout: [],
          stderr: [],
          sessionDelta: {
            data: [4, 5, 6],
            keep: 'yes',
            helper() { return 1; },
            counter: 1n
          }
        };
      `,
      { captureStructuredResult: true }
    );

    const resultMessage = messages.find((message) => message.type === 'result') as
      | { structured?: { sessionDelta?: Record<string, unknown> } }
      | undefined;
    expect(resultMessage?.structured?.sessionDelta).toMatchObject({
      data: [4, 5, 6],
      keep: 'yes',
    });
    expect(resultMessage?.structured?.sessionDelta).not.toHaveProperty('helper');
    expect(resultMessage?.structured?.sessionDelta).not.toHaveProperty('counter');
  });

  it('does not break a clean run when a structured value has a throwing getter', async () => {
    // A session variable with a throwing getter defeats structuredClone AND
    // the JSON fallback (Object.entries invokes the getter). The snapshot must
    // degrade to string-only — the run still reports a result, never an error.
    const messages = await executeJsWorkerCode(
      `
        const trap = {};
        Object.defineProperty(trap, 'boom', {
          enumerable: true,
          get() { throw new Error('side effect'); }
        });
        return { stdout: [], stderr: [], sessionDelta: { trap } };
      `,
      { captureStructuredResult: true }
    );

    // The run settles as a result (not an error), just without a structured
    // payload — exactly the graceful degradation the renderer falls back on.
    const resultMessage = messages.find((message) => message.type === 'result') as
      | { structured?: unknown }
      | undefined;
    expect(resultMessage).toBeDefined();
    expect(resultMessage?.structured).toBeUndefined();
    expect(messages.some((message) => message.type === 'error')).toBe(false);
  });

  // internal — lock the AsyncFunction trust boundary. The
  // worker is NOT a sandbox for hostile input, but the Web Worker
  // global contract still guarantees the Node-only `process` /
  // `require` symbols are absent from the worker global scope, so
  // user code that reaches for them gets `undefined` and cannot
  // escalate into Node.
  //
  // The harness imports the worker into vitest's jsdom environment,
  // which runs *inside* a Node process — so `globalThis.process` and
  // `globalThis.require` are ambiently present here purely as a
  // test-host artifact, NOT because the worker exposes them (the
  // worker file never references either symbol). To make the harness
  // faithful to the real browser Web Worker scope, we scrub those two
  // ambient Node globals for the duration of the import + execution,
  // then restore them. With the Node host globals removed, the only
  // way the executed body could still see `process`/`require` is if
  // the worker itself injected them — which is exactly the escape this
  // test is meant to catch. The body reads `typeof globalThis.process`
  // from inside the executed code (not the test's own scope) and
  // throws if either symbol is reachable, so a future bundler/runtime
  // change that leaks Node access into the worker fails CI here.
  it('cannot reach globalThis.process / globalThis.require from user code', async () => {
    const g = globalThis as Record<string, unknown>;
    const hadProcess = Object.prototype.hasOwnProperty.call(g, 'process');
    const hadRequire = Object.prototype.hasOwnProperty.call(g, 'require');
    const savedProcess = g.process;
    const savedRequire = g.require;

    // Remove the ambient Node host globals so the worker's
    // `new AsyncFunction(...)` body runs against a global scope that
    // matches the real Web Worker contract (both symbols absent).
    delete g.process;
    delete g.require;

    let messages: Array<Record<string, unknown>>;
    try {
      messages = await executeJsWorkerCode(`
        const hasProcess = typeof globalThis.process;
        const hasRequire = typeof globalThis.require;
        if (hasProcess !== 'undefined' || hasRequire !== 'undefined') {
          throw new Error(
            'SECURITY: Node symbols reachable — process=' +
              hasProcess +
              ' require=' +
              hasRequire
          );
        }
        console.log('node-symbols-absent');
      `);
    } finally {
      // Restore the Node host globals for the rest of the suite.
      if (hadProcess) {
        g.process = savedProcess;
      } else {
        delete g.process;
      }
      if (hadRequire) {
        g.require = savedRequire;
      } else {
        delete g.require;
      }
    }

    // No execution error means neither symbol was reachable (the
    // body throws if either is present, which would surface as an
    // `error` message here).
    const errorMessage = messages.find((message) => message.type === 'error');
    expect(errorMessage).toBeUndefined();

    // And the success log proves the body actually ran to completion
    // through the real worker scope rather than short-circuiting.
    const successLog = messages.find(
      (message) =>
        message.type === 'console' &&
        Array.isArray(message.args) &&
        (message.args as unknown[]).includes('node-symbols-absent')
    );
    expect(successLog).toBeDefined();
    expect(successLog).toMatchObject({ method: 'log' });
  });
});

// ---------------------------------------------------------------------------
// serialize / parseError behaviour tests
// These inline re-implementations mirror the private worker logic and ensure
// the expected serialisation contract is documented.
// ---------------------------------------------------------------------------

/** Mirror of the private serialize() in js-worker.ts */
function serialize(args: unknown[]): string[] {
  return args.map((arg) => {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'function') return `[Function: ${(arg as { name?: string }).name || 'anonymous'}]`;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  });
}

/** Mirror of the private parseError() in js-worker.ts */
function parseError(err: unknown): { message: string; line?: number; column?: number; stack?: string } {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }
  const result: { message: string; line?: number; column?: number; stack?: string } = {
    message: err.message,
    stack: err.stack,
  };
  if (err.stack) {
    const match = err.stack.match(/<anonymous>:(\d+):(\d+)/);
    if (match) {
      result.line = parseInt(match[1], 10);
      result.column = parseInt(match[2], 10);
    }
  }
  return result;
}

describe('worker serialize helper (protocol contract)', () => {
  it('serializes undefined as the string "undefined"', () => {
    expect(serialize([undefined])).toEqual(['undefined']);
  });

  it('serializes null as the string "null"', () => {
    expect(serialize([null])).toEqual(['null']);
  });

  it('passes through strings unchanged', () => {
    expect(serialize(['hello world'])).toEqual(['hello world']);
  });

  it('serializes numbers as JSON', () => {
    expect(serialize([42])).toEqual(['42']);
  });

  it('serializes plain objects as pretty-printed JSON', () => {
    expect(serialize([{ a: 1 }])).toEqual(['{\n  "a": 1\n}']);
  });

  it('serializes named functions with their name', () => {
    function myFunc() {}
    expect(serialize([myFunc])).toEqual(['[Function: myFunc]']);
  });

  it('serializes anonymous arrow functions as [Function: anonymous]', () => {
    const arrow = (() => {}) as unknown as { name: string };
    // arrow.name is '' in V8
    const result = serialize([arrow]);
    expect(result[0]).toMatch(/\[Function:/);
  });

  it('serializes Error instances as "Name: message"', () => {
    const err = new TypeError('bad type');
    expect(serialize([err])).toEqual(['TypeError: bad type']);
  });

  it('handles multiple args', () => {
    expect(serialize(['a', 1, null])).toEqual(['a', '1', 'null']);
  });
});

describe('worker parseError helper (protocol contract)', () => {
  it('converts non-Error values to { message: String(value) }', () => {
    expect(parseError('oops')).toEqual({ message: 'oops' });
    expect(parseError(42)).toEqual({ message: '42' });
  });

  it('extracts message from an Error', () => {
    const err = new Error('something failed');
    const result = parseError(err);
    expect(result.message).toBe('something failed');
  });

  it('includes the stack string', () => {
    const err = new Error('with stack');
    const result = parseError(err);
    expect(result.stack).toBeDefined();
  });

  it('does not set line/column when stack has no <anonymous> pattern', () => {
    const err = new Error('plain error');
    // Override stack to remove any <anonymous> pattern
    err.stack = 'Error: plain error\n    at Object.<anonymous> (test.js:1:1)';
    const result = parseError(err);
    // The pattern requires <anonymous>:LINE:COL format – this won't match
    expect(result.line).toBeUndefined();
  });
});
