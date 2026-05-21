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

async function executeJsWorkerCode(code: string): Promise<Array<Record<string, unknown>>> {
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
    // RL-044 Slice 2b-β-α prerequisite fix — the rejection text now
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
