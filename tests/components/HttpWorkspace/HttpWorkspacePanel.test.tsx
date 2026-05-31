import type { PropsWithChildren } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpWorkspacePanel } from '../../../src/renderer/components/HttpWorkspace';
import { useExecutionHistoryStore } from '../../../src/renderer/stores/executionHistoryStore';
import {
  resetWorkspaceToolStoreForTests,
  useWorkspaceToolStore,
} from '../../../src/renderer/stores/workspaceToolStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useLicenseStore } from '../../../src/renderer/stores/licenseStore';
import { useSessionStore } from '../../../src/renderer/stores/sessionStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import {
  createBlankHttpRequest,
  type HttpResponseV1,
} from '../../../src/shared/httpWorkspace';

const { executeHttpRequestMock } =
  vi.hoisted(() => ({
    executeHttpRequestMock: vi.fn(),
  }));

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
  Panel: ({ children }: PropsWithChildren<{ id?: string }>) => <div>{children}</div>,
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: vi.fn(),
  }),
}));

// SQL/HTTP MODEL rework — the workspace-tab-close tests drive the real
// `editorStore.closeTab`, whose `removeTab` fires a fire-and-forget
// `import('../runtime/notebookSession')` (lazy by design). That module
// statically pulls `runnerManager` → `esbuild-wasm`, which jsdom rejects
// with the `TextEncoder().encode("") instanceof Uint8Array` invariant.
// Because the import is unawaited, the rejection floats out as an
// unhandled error attributed to whichever workspace-panel test happens
// to be running. Stub the module so the dispose call resolves without
// loading the runner. (`disposeNotebookSession` is the only symbol the
// `removeTab` path touches.)
vi.mock('../../../src/renderer/runtime/notebookSession', () => ({
  disposeNotebookSession: vi.fn(),
}));

vi.mock('../../../src/renderer/runtime/httpClient', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/renderer/runtime/httpClient')>();
  return {
    ...actual,
    executeHttpRequest: executeHttpRequestMock,
  };
});

function makeResponse(): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 200,
    statusText: 'OK',
    url: 'https://api.example.com/users',
    finalUrl: 'https://api.example.com/users',
    headers: [],
    body: '{"ok":true}',
    contentType: 'application/json',
    sizeBytes: 11,
    durationMs: 10,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-05-26T00:00:00.000Z',
  };
}

describe('HttpWorkspacePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceToolStoreForTests();
    useExecutionHistoryStore.getState().clear();
    useSettingsStore.setState({ sensitiveHttpHeaders: [] });
    executeHttpRequestMock.mockReset();
    executeHttpRequestMock.mockResolvedValue(makeResponse());
  });

  it('sends the current editor draft even before the debounce settles', async () => {
    const user = userEvent.setup();
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    await user.type(
      screen.getByTestId('http-request-editor-url'),
      'https://api.example.com/users'
    );
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalledTimes(1));
    const sentRequest = executeHttpRequestMock.mock.calls[0]?.[0];
    expect(sentRequest.url).toBe('https://api.example.com/users');
    expect(
      useWorkspaceToolStore.getState().requests[0]?.url
    ).toBe('https://api.example.com/users');
  });

  it('records an HTTP response capsule as the latest exportable capsule', async () => {
    const user = userEvent.setup();
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    await user.type(
      screen.getByTestId('http-request-editor-url'),
      'https://api.example.com/users'
    );
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => {
      const latestCapsule = useExecutionHistoryStore.getState().latestCapsule();
      expect(latestCapsule?.tab.language).toBe('http');
      expect(latestCapsule?.environment.runner).toBe('http-client');
    });
  });
});

/**
 * SQL/HTTP MODEL rework — collection workspace path. The HTTP surface is
 * ONE Insomnia/Postman-style collection workspace tab, not one editor tab
 * per request. The in-panel rail is the single source of collection
 * navigation: create / select / delete operate on `useWorkspaceToolStore`
 * rows (`activeRequestId`). Every request — including the full set a
 * collection import drops in — is a first-class, directly-selectable rail
 * row; there is no per-request FileTab, no promotion dance, no budget gate.
 */
describe('HttpWorkspacePanel — collection workspace (rail-driven)', () => {
  function seedProLicense(): void {
    useLicenseStore.setState({
      token: 'test.token',
      status: {
        kind: 'active',
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.now() + 86_400_000,
          payload: {
            productId: 'lingua-desktop',
            tier: 'pro',
            issuedTo: 'test@example.com',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(
              Date.now() + 86_400_000
            ).toISOString(),
            entitlements: [],
          },
        },
      },
      lastVerifiedAt: Date.now(),
    });
  }

  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceToolStoreForTests();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useSessionStore.setState({ savedTabs: [], savedActiveIndex: -1 });
    seedProLicense();
    executeHttpRequestMock.mockReset();
    executeHttpRequestMock.mockResolvedValue(makeResponse());
    // Attach a minimal `window.lingua` stub onto the existing jsdom
    // `window` (do NOT replace the object, or Testing Library loses the
    // document). `closeTab` skips it for fresh tabs anyway.
    (window as unknown as { lingua: unknown }).lingua = {
      fs: {
        revokeRoot: vi.fn().mockResolvedValue(true),
      },
      confirmCloseTab: vi.fn().mockResolvedValue(1),
    };
  });

  afterEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
  });

  it('the single workspace tab carries the stable id; reopening never mints a second tab', () => {
    const first = useEditorStore.getState().addHttpTab();
    const second = useEditorStore.getState().addHttpTab();
    expect(first).toBe(second);
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'http').length
    ).toBe(1);
  });

  it('in-panel create adds a request row, NOT a new FileTab, and selects it', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().addHttpTab();
    render(<HttpWorkspacePanel />);

    const tabsBefore = useEditorStore.getState().tabs.length;
    const requestsBefore = useWorkspaceToolStore.getState().requests.length;
    await user.click(screen.getByTestId('http-request-list-create'));

    await waitFor(() => {
      expect(useWorkspaceToolStore.getState().requests.length).toBe(
        requestsBefore + 1
      );
    });
    expect(useEditorStore.getState().tabs.length).toBe(tabsBefore);
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'http').length
    ).toBe(1);
    const newId = useWorkspaceToolStore.getState().requests[0]!.id;
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe(newId);
  });

  it('deleting the active rail row removes the request and re-points active; the workspace tab survives', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().addHttpTab();
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    const firstReqId = useWorkspaceToolStore.getState().requests[0]!.id;
    await user.click(screen.getByTestId('http-request-list-create'));
    const secondReqId = useWorkspaceToolStore.getState().requests[0]!.id;
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe(secondReqId);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deleteButtons = screen.getAllByTestId('http-request-list-delete');
    // Rows are newest-first → the active (second) request is row 0.
    await user.click(deleteButtons[0]!);
    confirmSpy.mockRestore();

    await waitFor(() => {
      expect(
        useWorkspaceToolStore.getState().getRequest(secondReqId)
      ).toBeUndefined();
    });
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe(firstReqId);
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'http').length
    ).toBe(1);
  });

  it('closing the workspace tab keeps the collection (it rehydrates on reopen)', async () => {
    const user = userEvent.setup();
    const tabId = useEditorStore.getState().addHttpTab()!;
    render(<HttpWorkspacePanel />);
    await user.click(screen.getByTestId('http-request-list-create'));
    const reqId = useWorkspaceToolStore.getState().requests[0]!.id;

    await useEditorStore.getState().closeTab(tabId);

    expect(
      useEditorStore.getState().tabs.some((t) => t.id === tabId)
    ).toBe(false);
    expect(useWorkspaceToolStore.getState().getRequest(reqId)).toBeDefined();

    const reopened = useEditorStore.getState().addHttpTab();
    expect(reopened).toBe(tabId);
    expect(useWorkspaceToolStore.getState().getRequest(reqId)).toBeDefined();
  });

  it('selecting a rail row moves the store active request (no FileTab focus dance)', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().addHttpTab();
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    const firstId = useWorkspaceToolStore.getState().requests[0]!.id;
    await user.click(screen.getByTestId('http-request-list-create'));
    const secondId = useWorkspaceToolStore.getState().requests[0]!.id;
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe(secondId);

    const rows = screen.getAllByTestId('http-request-list-row');
    const firstRow = rows.find(
      (r) => r.getAttribute('data-request-id') === firstId
    );
    expect(firstRow).toBeDefined();
    await user.click(firstRow!);

    await waitFor(() => {
      expect(useWorkspaceToolStore.getState().activeRequestId).toBe(firstId);
    });
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'http').length
    ).toBe(1);
  });

  /**
   * Collection import — every imported request is a first-class rail row.
   * A Postman/Bruno import drops all N requests into the collection via
   * `createRequests`; the single workspace tab surfaces all of them, and
   * each is directly selectable (no per-request tab, no promotion, no
   * up-front tab/upsell storm). On Free the import still works because the
   * workspace tab is exempt from the tab budget.
   */
  it('every imported collection request is directly selectable on the single workspace tab', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().addHttpTab();
    // Simulate a collection import: createRequests drops every request in.
    const reqA = {
      ...createBlankHttpRequest({ id: crypto.randomUUID(), name: 'List' }),
      method: 'GET' as const,
      url: 'https://x.dev/users',
    };
    const reqB = {
      ...createBlankHttpRequest({ id: crypto.randomUUID(), name: 'Create' }),
      method: 'POST' as const,
      url: 'https://x.dev/users',
    };
    useWorkspaceToolStore.getState().createRequests([reqA, reqB]);

    render(<HttpWorkspacePanel />);

    const httpTabsBefore = useEditorStore
      .getState()
      .tabs.filter((t) => t.kind === 'http').length;
    // Click the second request's row — directly selectable, no promotion.
    const rowB = screen
      .getAllByTestId('http-request-list-row')
      .find((r) => r.getAttribute('data-request-id') === reqB.id);
    expect(rowB).toBeDefined();
    await user.click(rowB!);

    await waitFor(() => {
      expect(useWorkspaceToolStore.getState().activeRequestId).toBe(reqB.id);
    });
    // No second workspace tab was minted; both requests still in the
    // collection (nothing dropped or promoted).
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'http').length
    ).toBe(httpTabsBefore);
    expect(useWorkspaceToolStore.getState().getRequest(reqA.id)).toBeDefined();
    expect(useWorkspaceToolStore.getState().getRequest(reqB.id)).toBeDefined();
  });
});
