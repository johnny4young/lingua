import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LSP_DOCUMENT_SYNC_DEBOUNCE_MS,
  useLspDocumentSync,
  useLspLifecycle,
} from '@/hooks/useLspLifecycle';
import type { LspLanguageIntelligenceAdapter } from '@/languageIntelligence/types';
import { createLspLanguageStore } from '@/stores/lspLanguageStoreFactory';
import { useUIStore } from '@/stores/uiStore';

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

const lifecycleStore = createLspLanguageStore();
const documentStore = createLspLanguageStore();
const isLspAvailable = () => true;
const getLspBridge = () => ({
  start: async () => ({ kind: 'running' as const, version: 'test' }),
  status: async () => ({ kind: 'running' as const, version: 'test' }),
  onStatusChanged: () => () => {},
});

function LifecycleHarness({
  loadAdapter,
}: {
  loadAdapter: () => Promise<LspLanguageIntelligenceAdapter | null>;
}) {
  useLspLifecycle({
    language: 'rust',
    diagnosticSource: 'rust-analyzer',
    toastMessageKey: 'languageIntelligence.rust.toast.ready',
    adapterLoadFailedMessageKey: 'languageIntelligence.rust.toast.adapterLoadFailed',
    store: lifecycleStore,
    isAvailable: isLspAvailable,
    loadAdapter,
    getBridge: getLspBridge,
  });
  return null;
}

interface DocumentHarnessProps {
  loadAdapter: () => Promise<{
    openDocument: (uri: string, content: string) => void;
    closeDocument: (uri: string) => void;
  } | null>;
  getAdapter: () => {
    openDocument: (uri: string, content: string) => void;
    closeDocument: (uri: string) => void;
  } | null;
}

function DocumentHarness({ loadAdapter, getAdapter }: DocumentHarnessProps) {
  useLspDocumentSync(
    {
      getModel: () => ({ uri: { toString: () => 'inmemory://model/stale' } }),
    },
    { id: 'tab-rs', language: 'rust', content: 'fn main() {}' },
    {
      language: 'rust',
      store: documentStore,
      getAdapter,
      loadAdapter,
    }
  );
  return null;
}

describe('useLspLifecycle', () => {
  beforeEach(() => {
    lifecycleStore.getState().reset();
    documentStore.getState().reset();
    useUIStore.getState().dismissStatusNotice();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useUIStore.getState().dismissStatusNotice();
  });

  it('surfaces an adapter load failure without leaving the server marked available', async () => {
    lifecycleStore.getState().setStatus({ kind: 'available', version: 'test' });
    render(<LifecycleHarness loadAdapter={() => Promise.reject(new Error('chunk failed'))} />);

    await waitFor(() => {
      expect(lifecycleStore.getState().status).toEqual({
        kind: 'degraded',
        reason: 'adapter-load-failed',
      });
    });
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'error',
      messageKey: 'languageIntelligence.rust.toast.adapterLoadFailed',
    });
  });

  it('does not open a stale document when the adapter resolves after unmount', async () => {
    vi.useFakeTimers();
    documentStore.getState().setStatus({ kind: 'available', version: 'test' });

    let resolveAdapter:
      | ((adapter: {
          openDocument: (uri: string, content: string) => void;
          closeDocument: (uri: string) => void;
        }) => void)
      | undefined;
    const openDocument = vi.fn();
    const adapter = { openDocument, closeDocument: vi.fn() };
    const loadAdapter = vi.fn(
      () =>
        new Promise<typeof adapter>(resolve => {
          resolveAdapter = resolve;
        })
    );
    const { unmount } = render(
      <DocumentHarness loadAdapter={loadAdapter} getAdapter={() => null} />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LSP_DOCUMENT_SYNC_DEBOUNCE_MS);
    });
    expect(loadAdapter).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveAdapter?.(adapter);
      await Promise.resolve();
    });

    expect(openDocument).not.toHaveBeenCalled();
  });
});
