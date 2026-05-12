/**
 * RL-026 Slice 4 — `GoLanguageIntelligenceAdapter` contract tests.
 *
 * Mirrors the rust adapter test suite. The adapter is the renderer-
 * side glue between the Monaco providers and the main-process LSP
 * bridge; the fake transport keeps the JSON-RPC traffic deterministic
 * without spawning gopls.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  GoLanguageIntelligenceAdapter,
  type GoAdapterTransport,
} from '../../src/renderer/languageIntelligence/go';

interface FakeTransportSetup {
  transport: GoAdapterTransport;
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

  const transport: GoAdapterTransport = {
    request: (method, params) => {
      requests.push({ method, params });
      return new Promise<{ ok: true; result: unknown } | { ok: false; error: string }>(
        (resolve) => {
          pendingResolve = (result) => resolve({ ok: true, result });
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

describe('GoLanguageIntelligenceAdapter', () => {
  it('emits didOpen with languageId "go" on first openDocument', () => {
    const { transport, notifications } = setupTransport();
    const adapter = new GoLanguageIntelligenceAdapter(transport);

    adapter.openDocument('file:///a/main.go', 'package main\n');

    expect(notifications[0]?.method).toBe('textDocument/didOpen');
    expect(notifications[0]?.params).toEqual({
      textDocument: {
        uri: 'file:///a/main.go',
        languageId: 'go',
        version: 1,
        text: 'package main\n',
      },
    });
  });

  it('emits didChange on a subsequent openDocument with new content', () => {
    const { transport, notifications } = setupTransport();
    const adapter = new GoLanguageIntelligenceAdapter(transport);

    adapter.openDocument('file:///a/main.go', 'package main\n');
    adapter.openDocument('file:///a/main.go', 'package main\n\nfunc main() {}\n');

    expect(notifications[1]?.method).toBe('textDocument/didChange');
  });

  it('routes publishDiagnostics through 1-based positions', () => {
    const { transport, emit } = setupTransport();
    const adapter = new GoLanguageIntelligenceAdapter(transport);
    const received: Array<{ uri: string; messages: string[] }> = [];

    adapter.subscribeDiagnostics((uri, diagnostics) => {
      received.push({ uri, messages: diagnostics.map((d) => d.message) });
    });

    emit({
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///a/main.go',
        diagnostics: [
          {
            range: {
              start: { line: 2, character: 4 },
              end: { line: 2, character: 9 },
            },
            severity: 1,
            message: 'undeclared name: foo',
          },
        ],
      },
    });

    expect(received).toEqual([
      { uri: 'file:///a/main.go', messages: ['undeclared name: foo'] },
    ]);
  });

  it('parses CompletionList response shape into the common contract', async () => {
    const setup = setupTransport();
    const adapter = new GoLanguageIntelligenceAdapter(setup.transport);

    const pending = adapter.provideCompletions('file:///a/main.go', 1, 1);
    setup.resolveNext({
      isIncomplete: false,
      items: [
        { label: 'Println', kind: 2, detail: 'func(a ...any) (n int, err error)' },
        { label: 'Sprintf', kind: 2 },
        { label: '', kind: 2 },
      ],
    });

    const completions = await pending;
    expect(completions.map((c) => c.label)).toEqual(['Println', 'Sprintf']);
    expect(completions[0]?.kind).toBe('function');
  });

  it('parses gopls hover markdown into a structured payload', async () => {
    const setup = setupTransport();
    const adapter = new GoLanguageIntelligenceAdapter(setup.transport);

    const pending = adapter.provideHover('file:///a/main.go', 1, 1);
    setup.resolveNext({
      contents: {
        kind: 'markdown',
        value: '```go\nfunc Println(a ...any) (n int, err error)\n```\nPrints the operands to standard output.',
      },
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 8 } },
    });

    const hover = await pending;
    expect(hover?.kind).toBe('function');
    expect(hover?.symbol).toBe('func Println(a ...any) (n int, err error)');
    expect(hover?.definedAtLine).toBe(5);
  });

  it('parses signatureHelp into a single active signature', async () => {
    const setup = setupTransport();
    const adapter = new GoLanguageIntelligenceAdapter(setup.transport);

    const pending = adapter.provideSignatureHelp('file:///a/main.go', 1, 1);
    setup.resolveNext({
      signatures: [
        {
          label: 'func Println(a ...any) (n int, err error)',
          parameters: [{ label: 'a ...any' }],
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
    });

    const sig = await pending;
    expect(sig?.symbol).toBe('func Println(a ...any) (n int, err error)');
    expect(sig?.parameters.map((p) => p.label)).toEqual(['a ...any']);
    expect(sig?.activeParameter).toBe(0);
  });

  it('disposes pending document state and unsubscribes notifications', () => {
    const setup = setupTransport();
    const adapter = new GoLanguageIntelligenceAdapter(setup.transport);
    const listener = vi.fn();
    adapter.subscribeDiagnostics(listener);

    adapter.openDocument('file:///a/main.go', 'package main\n');
    adapter.dispose();

    expect(setup.notifications.some((n) => n.method === 'textDocument/didClose')).toBe(true);

    setup.emit({
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///a/main.go', diagnostics: [] },
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
