/**
 * implementation — `LspProcess` framing + lifecycle contract.
 *
 * The wrapper is the foundation for the Rust LSP integration. These
 * tests pin:
 *   - partial-chunk Content-Length reassembly
 *   - Unicode payload roundtrip (multi-byte body)
 *   - back-to-back framed messages inside a single chunk
 *   - response routing by `id`
 *   - notification dispatch by `method`
 *   - graceful `dispose()` and `whenExited()` resolution
 *   - in-flight request rejection on crash
 *
 * We mock `node:child_process.spawn` to return a fake `ChildProcess`
 * whose stdout we drive manually. Going through the real spawn would
 * introduce platform-dependent flakiness for a code path that is pure
 * I/O framing.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach } from 'vitest';

interface FakeChild extends EventEmitter {
  stdin: {
    // `on` mirrors the runtime contract: LspProcess attaches a stdin
    // 'error' listener (async EPIPE guard) right after spawn.
    on: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writable: boolean;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = { on: vi.fn(), write: vi.fn(() => true), writable: true };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    child.emit('exit', 0, null);
    return true;
  });
  return child;
}

let currentChild: FakeChild | null = null;
const spawnMock = vi.fn();

// Matches the pattern used by `tests/main/formatters.test.ts`. Vitest's
// module mocker hoists this factory above every `import`, so the
// `spawnMock` reference here points at the same `vi.fn()` the test
// body manipulates — but only if we keep the mock factory shape (named
// exports + matching `default`) identical to a real CJS-friendly node
// module.
vi.mock('node:child_process', async () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}));

beforeEach(() => {
  currentChild = createFakeChild();
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => currentChild);
});

async function nextTick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function framedMessage(payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, body]);
}

describe('LspProcess', () => {
  it('dispatches a notification from a single framed chunk', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    const seen: string[] = [];
    const lsp = new LspProcess({
      command: 'fake',
      onNotification: (notif) => seen.push(notif.method),
    });
    lsp.start();

    currentChild!.stdout.emit(
      'data',
      framedMessage({ jsonrpc: '2.0', method: 'window/logMessage', params: {} })
    );

    expect(seen).toEqual(['window/logMessage']);
  });

  it('reassembles a message split across multiple chunks', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    const seen: string[] = [];
    const lsp = new LspProcess({
      command: 'fake',
      onNotification: (notif) => seen.push(notif.method),
    });
    lsp.start();

    const message = framedMessage({ jsonrpc: '2.0', method: 'split/test', params: {} });
    currentChild!.stdout.emit('data', message.subarray(0, 4));
    expect(seen).toEqual([]);
    currentChild!.stdout.emit('data', message.subarray(4, 20));
    expect(seen).toEqual([]);
    currentChild!.stdout.emit('data', message.subarray(20));
    expect(seen).toEqual(['split/test']);
  });

  it('dispatches two back-to-back messages from one chunk', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    const seen: string[] = [];
    const lsp = new LspProcess({
      command: 'fake',
      onNotification: (notif) => seen.push(notif.method),
    });
    lsp.start();

    const combined = Buffer.concat([
      framedMessage({ jsonrpc: '2.0', method: 'one' }),
      framedMessage({ jsonrpc: '2.0', method: 'two' }),
    ]);
    currentChild!.stdout.emit('data', combined);

    expect(seen).toEqual(['one', 'two']);
  });

  it('handles a multi-byte Unicode payload by counting bytes', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    let seenParams: unknown = null;
    const lsp = new LspProcess({
      command: 'fake',
      onNotification: (notif) => {
        seenParams = notif.params;
      },
    });
    lsp.start();

    const payload = {
      jsonrpc: '2.0',
      method: 'note',
      params: { text: '日本語テスト 🦀' },
    };
    currentChild!.stdout.emit('data', framedMessage(payload));

    expect(seenParams).toEqual({ text: '日本語テスト 🦀' });
  });

  it('routes a response back to the matching request id', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    const lsp = new LspProcess({ command: 'fake' });
    lsp.start();

    const pending = lsp.sendRequest<{ ok: boolean }>('test/echo', { say: 'hi' });
    expect(currentChild!.stdin.write).toHaveBeenCalled();

    currentChild!.stdout.emit(
      'data',
      framedMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    );

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('rejects a request when the server returns an error', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    const lsp = new LspProcess({ command: 'fake' });
    lsp.start();

    const pending = lsp.sendRequest('test/fail');
    currentChild!.stdout.emit(
      'data',
      framedMessage({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'boom' },
      })
    );

    await expect(pending).rejects.toThrow(/boom/);
  });

  it('rejects every in-flight request when the child crashes', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    const lsp = new LspProcess({ command: 'fake' });
    lsp.start();

    const a = lsp.sendRequest('a');
    const b = lsp.sendRequest('b');

    currentChild!.emit('exit', 137, null);

    await expect(a).rejects.toThrow(/exited before responding/);
    await expect(b).rejects.toThrow(/exited before responding/);
  });

  it('treats a synthetic spawn error as immediate exit', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    const exits: Array<{ code: number | null; signal: NodeJS.Signals | null }> = [];
    const lsp = new LspProcess({
      command: 'fake',
      onExit: (code, signal) => exits.push({ code, signal }),
    });
    lsp.start();

    currentChild!.emit('error', new Error('ENOENT'));

    expect(exits).toEqual([{ code: -1, signal: null }]);
  });

  it('dispose() is idempotent and resolves whenExited', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    const lsp = new LspProcess({ command: 'fake' });
    lsp.start();

    const exitPromise = lsp.whenExited();
    lsp.dispose();
    lsp.dispose(); // idempotent — no double-kill
    expect(currentChild!.kill).toHaveBeenCalledTimes(1);

    await nextTick();
    await expect(exitPromise).resolves.toEqual({ code: 0, signal: null });
  });

  it('drops malformed JSON inside a framed message without crashing', async () => {
    const { LspProcess } = await import('../../../src/main/lsp/lspProcess');
    const seen: string[] = [];
    const lsp = new LspProcess({
      command: 'fake',
      onNotification: (notif) => seen.push(notif.method),
    });
    lsp.start();

    const body = Buffer.from('not really json', 'utf8');
    const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii');
    currentChild!.stdout.emit('data', Buffer.concat([header, body]));
    currentChild!.stdout.emit(
      'data',
      framedMessage({ jsonrpc: '2.0', method: 'recovered' })
    );

    expect(seen).toEqual(['recovered']);
  });
});
