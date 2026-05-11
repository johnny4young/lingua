import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import {
  RUST_LSP_DOCUMENT_SYNC_DEBOUNCE_MS,
  useRustLspDocumentSync,
} from '@/hooks/useRustLspLifecycle';
import { RustLanguageIntelligenceAdapter } from '@/languageIntelligence/rust';
import { __setRustAdapterForTesting } from '@/languageIntelligence/rustAdapterSingleton';
import { useRustLanguageStore } from '@/stores/rustLanguageStore';

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({
  MarkerSeverity: {
    Error: 8,
    Warning: 4,
    Info: 2,
  },
  editor: {
    getModels: vi.fn(() => []),
    setModelMarkers: vi.fn(),
  },
}));

interface HarnessProps {
  editor: { getModel: () => { uri: { toString: () => string } } | null };
  activeTab: { id: string; language: string; content: string } | null;
}

function Harness({ editor, activeTab }: HarnessProps) {
  useRustLspDocumentSync(editor, activeTab);
  return null;
}

describe('useRustLspDocumentSync', () => {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const editor = {
    getModel: () => ({ uri: { toString: () => 'inmemory://model/1' } }),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    notifications.length = 0;
    useRustLanguageStore.getState().reset();
    useRustLanguageStore
      .getState()
      .setStatus({ kind: 'available', version: 'rust-analyzer test' });
    __setRustAdapterForTesting(
      new RustLanguageIntelligenceAdapter({
        request: async () => ({ ok: true, result: null }),
        notify: (method, params) => {
          notifications.push({ method, params });
        },
        onNotification: () => () => {},
      })
    );
  });

  afterEach(() => {
    cleanup();
    __setRustAdapterForTesting(null);
    useRustLanguageStore.getState().reset();
    vi.useRealTimers();
  });

  it('opens the active Rust document and sends debounced content changes', async () => {
    const { rerender } = render(
      <Harness
        editor={editor}
        activeTab={{ id: 'tab-rs', language: 'rust', content: 'fn main() {}' }}
      />
    );

    expect(notifications).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUST_LSP_DOCUMENT_SYNC_DEBOUNCE_MS);
    });

    expect(notifications[0]).toMatchObject({
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'inmemory://model/1',
          languageId: 'rust',
          version: 1,
          text: 'fn main() {}',
        },
      },
    });

    await act(async () => {
      rerender(
        <Harness
          editor={editor}
          activeTab={{
            id: 'tab-rs',
            language: 'rust',
            content: 'fn main() { println!("hi"); }',
          }}
        />
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUST_LSP_DOCUMENT_SYNC_DEBOUNCE_MS);
    });

    expect(notifications[1]).toMatchObject({
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: 'inmemory://model/1', version: 2 },
        contentChanges: [{ text: 'fn main() { println!("hi"); }' }],
      },
    });
  });

  it('closes the Rust document when the editor surface unmounts', async () => {
    const { unmount } = render(
      <Harness
        editor={editor}
        activeTab={{ id: 'tab-rs', language: 'rust', content: 'fn main() {}' }}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUST_LSP_DOCUMENT_SYNC_DEBOUNCE_MS);
    });

    await act(async () => {
      unmount();
    });

    expect(notifications.some((entry) => entry.method === 'textDocument/didClose')).toBe(
      true
    );
  });
});
