/**
 * implementation — `RustLanguageIntelligenceAdapter` contract tests.
 *
 * The adapter is the renderer-side glue between the Monaco providers
 * and the main-process LSP bridge. These tests use a fake transport so
 * we can drive the JSON-RPC traffic deterministically without spawning
 * rust-analyzer.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  RustLanguageIntelligenceAdapter,
  type RustAdapterTransport,
} from '../../src/renderer/languageIntelligence/rust';

interface FakeTransportSetup {
  transport: RustAdapterTransport;
  emit: (notification: { method: string; params?: unknown }) => void;
  requests: Array<{ method: string; params: unknown }>;
  notifications: Array<{ method: string; params: unknown }>;
  resolveNext: (result: unknown) => void;
}

function setupTransport(): FakeTransportSetup {
  let notificationListener:
    | ((notification: { method: string; params?: unknown }) => void)
    | null = null;
  const requests: Array<{ method: string; params: unknown }> = [];
  const notifications: Array<{ method: string; params: unknown }> = [];
  let pendingResolve: ((value: unknown) => void) | null = null;

  const transport: RustAdapterTransport = {
    request: (method, params) => {
      requests.push({ method, params });
      return new Promise<Result<unknown>>(
        (resolve) => {
          pendingResolve = (result) => resolve({ ok: true, data: result });
        }
      );
    },
    notify: (method, params) => {
      notifications.push({ method, params });
    },
    onNotification: (callback) => {
      notificationListener = callback;
      return () => {
        notificationListener = null;
      };
    },
  };

  return {
    transport,
    emit: (notification) => {
      if (notificationListener) {
        notificationListener({ jsonrpc: '2.0', ...notification });
      }
    },
    requests,
    notifications,
    resolveNext: (result) => {
      pendingResolve?.(result);
      pendingResolve = null;
    },
  };
}

describe('RustLanguageIntelligenceAdapter', () => {
  it('emits didOpen on first openDocument and didChange on the next call', () => {
    const { transport, notifications } = setupTransport();
    const adapter = new RustLanguageIntelligenceAdapter(transport);

    adapter.openDocument('file:///a/main.rs', 'fn main() {}');
    adapter.openDocument('file:///a/main.rs', 'fn main() { println!("hi"); }');

    expect(notifications[0]?.method).toBe('textDocument/didOpen');
    expect(notifications[1]?.method).toBe('textDocument/didChange');
  });

  it('skips didChange when content is identical', () => {
    const { transport, notifications } = setupTransport();
    const adapter = new RustLanguageIntelligenceAdapter(transport);

    adapter.openDocument('file:///a/main.rs', 'fn main() {}');
    adapter.changeDocument('file:///a/main.rs', 'fn main() {}');

    expect(notifications.filter((n) => n.method === 'textDocument/didChange')).toHaveLength(
      0
    );
  });

  it('routes publishDiagnostics to subscribers with 1-based positions', () => {
    const { transport, emit } = setupTransport();
    const adapter = new RustLanguageIntelligenceAdapter(transport);
    const received: Array<{ uri: string; messages: string[] }> = [];

    adapter.subscribeDiagnostics((uri, diagnostics) => {
      received.push({ uri, messages: diagnostics.map((d) => d.message) });
    });

    emit({
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///a/main.rs',
        diagnostics: [
          {
            range: {
              start: { line: 2, character: 4 },
              end: { line: 2, character: 9 },
            },
            severity: 1,
            message: 'mismatched types',
          },
        ],
      },
    });

    expect(received).toEqual([
      {
        uri: 'file:///a/main.rs',
        messages: ['mismatched types'],
      },
    ]);
  });

  it('parses CompletionList response shape into the common contract', async () => {
    const setup = setupTransport();
    const adapter = new RustLanguageIntelligenceAdapter(setup.transport);

    const pending = adapter.provideCompletions('file:///a/main.rs', 1, 1);
    setup.resolveNext({
      isIncomplete: false,
      items: [
        { label: 'println', kind: 3, detail: 'macro_rules! println' },
        { label: 'print', kind: 3 },
        { label: '', kind: 3 },
      ],
    });

    const completions = await pending;
    expect(completions.map((c) => c.label)).toEqual(['println', 'print']);
    expect(completions[0]?.kind).toBe('function');
  });

  it('returns an empty completion list when the server responds with null', async () => {
    const setup = setupTransport();
    const adapter = new RustLanguageIntelligenceAdapter(setup.transport);

    const pending = adapter.provideCompletions('file:///a/main.rs', 1, 1);
    setup.resolveNext(null);

    await expect(pending).resolves.toEqual([]);
  });

  it('parses hover markdown content into a structured payload', async () => {
    const setup = setupTransport();
    const adapter = new RustLanguageIntelligenceAdapter(setup.transport);

    const pending = adapter.provideHover('file:///a/main.rs', 1, 1);
    setup.resolveNext({
      contents: {
        kind: 'markdown',
        value: '```rust\npub fn main() -> ()\n```\nEntry point of a Rust program.',
      },
      range: { start: { line: 3, character: 0 }, end: { line: 3, character: 4 } },
    });

    const hover = await pending;
    expect(hover?.kind).toBe('function');
    expect(hover?.symbol).toBe('pub fn main() -> ()');
    expect(hover?.definedAtLine).toBe(4);
  });

  it('parses signatureHelp into a single active signature', async () => {
    const setup = setupTransport();
    const adapter = new RustLanguageIntelligenceAdapter(setup.transport);

    const pending = adapter.provideSignatureHelp('file:///a/main.rs', 1, 1);
    setup.resolveNext({
      signatures: [
        {
          label: 'fn push(&mut self, value: T)',
          parameters: [{ label: '&mut self' }, { label: 'value: T' }],
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    });

    const sig = await pending;
    expect(sig?.symbol).toBe('fn push(&mut self, value: T)');
    expect(sig?.parameters.map((p) => p.label)).toEqual(['&mut self', 'value: T']);
    expect(sig?.activeParameter).toBe(1);
  });

  it('handles parameter labels expressed as [start, end] tuples', async () => {
    const setup = setupTransport();
    const adapter = new RustLanguageIntelligenceAdapter(setup.transport);

    const pending = adapter.provideSignatureHelp('file:///a/main.rs', 1, 1);
    setup.resolveNext({
      signatures: [
        {
          label: 'fn foo(a: i32, b: i32)',
          parameters: [
            { label: [7, 13] },
            { label: [15, 21] },
          ],
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
    });

    const sig = await pending;
    expect(sig?.parameters.map((p) => p.label)).toEqual(['a: i32', 'b: i32']);
  });

  it('disposes pending document state and unsubscribes notifications', () => {
    const setup = setupTransport();
    const adapter = new RustLanguageIntelligenceAdapter(setup.transport);
    const listener = vi.fn();
    adapter.subscribeDiagnostics(listener);

    adapter.openDocument('file:///a/main.rs', 'fn main() {}');
    adapter.dispose();

    // After dispose, the close notification fired.
    expect(setup.notifications.some((n) => n.method === 'textDocument/didClose')).toBe(true);

    // Subsequent emits no longer reach the listener — the unsubscribe
    // path in onNotification cleared the listener.
    setup.emit({
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///a/main.rs', diagnostics: [] },
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
