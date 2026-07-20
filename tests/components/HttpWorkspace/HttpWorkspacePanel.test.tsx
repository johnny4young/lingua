import type { PropsWithChildren } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { useAnnouncerStore } from '../../../src/renderer/stores/announcerStore';
import {
  createBlankHttpRequest,
  type HttpResponseV1,
} from '../../../src/shared/httpWorkspace';

const { executeHttpRequestMock } =
  vi.hoisted(() => ({
    executeHttpRequestMock: vi.fn(),
  }));

vi.mock('react-resizable-panels', () => ({
  Group: ({
    children,
    className,
    orientation,
  }: PropsWithChildren<{ className?: string; orientation?: string }>) => (
    <div
      className={className}
      data-testid="http-workspace-layout"
      data-orientation={orientation}
    >
      {children}
    </div>
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

function makeResponse(overrides: Partial<HttpResponseV1> = {}): HttpResponseV1 {
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
    ...overrides,
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
    useAnnouncerStore.setState({ message: '', nonce: 0 });
  });

  it('lays out request list, editor, and response as columns', () => {
    render(<HttpWorkspacePanel />);
    expect(screen.getByTestId('http-workspace-layout').dataset.orientation).toBe(
      'horizontal'
    );
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

  it('cancelling an in-flight request records no response and clears execution state', async () => {
    const user = userEvent.setup();
    // A send that never settles until we resolve it — models an in-flight
    // request the user cancels.
    let resolveSend: ((value: ReturnType<typeof makeResponse>) => void) | null =
      null;
    executeHttpRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    await user.type(
      screen.getByTestId('http-request-editor-url'),
      'https://api.example.com/slow'
    );
    await user.click(screen.getByTestId('http-request-editor-send'));

    // The Send button flipped to Stop while in flight.
    const stopButton = await screen.findByTestId('http-request-editor-stop');
    const reqId = useWorkspaceToolStore.getState().requests[0]!.id;
    expect(useWorkspaceToolStore.getState().executingRequestId).toBe(reqId);

    // Cancel, then let the (now-aborted) send settle late.
    await user.click(stopButton);
    resolveSend?.(makeResponse());
    await new Promise((resolve) => setTimeout(resolve, 0));

    // No response recorded, execution state cleared, ready to retry.
    expect(
      useWorkspaceToolStore.getState().responsesByRequestId[reqId]
    ).toBeUndefined();
    expect(useWorkspaceToolStore.getState().executingRequestId).toBeNull();
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
    // accessibility pass — the response is announced to screen readers.
    expect(useAnnouncerStore.getState().message).toMatch(/Response 200/i);
  });

  it('announces non-2xx HTTP responses with their status code (accessibility pass)', async () => {
    const user = userEvent.setup();
    executeHttpRequestMock.mockResolvedValue(
      makeResponse({
        kind: 'client-error',
        status: 404,
        statusText: 'Not Found',
      })
    );
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    await user.type(
      screen.getByTestId('http-request-editor-url'),
      'https://api.example.com/missing'
    );
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => {
      expect(useAnnouncerStore.getState().message).toMatch(
        /Response 404 Not Found/i
      );
    });
  });

  it('announces a transport failure (status 0) as a generic failure, not a 0 status (accessibility pass)', async () => {
    const user = userEvent.setup();
    // A network/timeout/cors error has no HTTP status — the runtime sets
    // status 0. The announcer must NOT read out "Response 0"; it falls back
    // to the generic failure phrasing.
    executeHttpRequestMock.mockResolvedValue(
      makeResponse({ kind: 'network-error', status: 0, statusText: '' })
    );
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    await user.type(
      screen.getByTestId('http-request-editor-url'),
      'https://api.example.com/unreachable'
    );
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => {
      expect(useAnnouncerStore.getState().message).toMatch(/Request failed/i);
    });
    expect(useAnnouncerStore.getState().message).not.toMatch(/Response 0/i);
  });

  // ---- implementation — environment interpolation + secret redaction ----

  it('interpolates the active environment into the OUTBOUND request', async () => {
    const user = userEvent.setup();
    // Seed an active environment with a host binding.
    useWorkspaceToolStore.setState({
      environments: [
        {
          version: 1,
          id: 'e1',
          name: 'Dev',
          variables: [
            { key: 'host', value: 'api.example.com', secret: false },
          ],
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
        },
      ],
      activeEnvironmentId: 'e1',
    });
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    // `fireEvent.change` sets the literal value — `user.type` would treat
    // `{{` as a userEvent escape and mangle the token to `{host}}`.
    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://{{host}}/users' },
    });
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalledTimes(1));
    const sentRequest = executeHttpRequestMock.mock.calls[0]?.[0];
    // The outbound (fetched) request carries the RESOLVED url.
    expect(sentRequest.url).toBe('https://api.example.com/users');
  });

  it('BLOCKS the send when a referenced variable has no value (no fetch, no recorded response)', async () => {
    const user = userEvent.setup();
    // Active env that does NOT define {{host}}.
    useWorkspaceToolStore.setState({
      environments: [
        {
          version: 1,
          id: 'e1',
          name: 'Dev',
          variables: [],
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
        },
      ],
      activeEnvironmentId: 'e1',
    });
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://{{host}}/users' },
    });
    const reqId = useWorkspaceToolStore.getState().requests[0]!.id;
    await user.click(screen.getByTestId('http-request-editor-send'));

    // The send is blocked: fetch is never called, nothing recorded.
    // Give the (rejected) async handler a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executeHttpRequestMock).not.toHaveBeenCalled();
    expect(
      useWorkspaceToolStore.getState().responsesByRequestId[reqId]
    ).toBeUndefined();
    // The execution flag is reset (the user can retry after fixing).
    expect(useWorkspaceToolStore.getState().executingRequestId).toBeNull();
  });

  it('PRIVACY: a resolved secret never reaches the recorded response or the capsule', async () => {
    const user = userEvent.setup();
    const SECRET = 'sk-live-SUPERSECRET';
    // The mocked server ECHOES the secret back in the body, a header,
    // the ORIGINAL url, and the final URL — the worst case the scrubber
    // must catch. `url` is the resolved outbound URL, so a secret in a
    // query param rides it verbatim (the field the live smoke caught
    // leaking past the scrubber).
    executeHttpRequestMock.mockResolvedValue({
      version: 1,
      kind: 'success',
      status: 200,
      statusText: 'OK',
      url: `https://api.example.com/users?token=${SECRET}`,
      finalUrl: `https://api.example.com/cb?token=${SECRET}`,
      headers: [{ name: 'X-Echo', value: SECRET, redacted: false }],
      body: `{"echo":"${SECRET}"}`,
      contentType: 'application/json',
      sizeBytes: 40,
      durationMs: 5,
      tooLarge: false,
      redactedHeaders: [],
      recordedAt: '2026-06-16T00:00:00.000Z',
    });
    useWorkspaceToolStore.setState({
      environments: [
        {
          version: 1,
          id: 'e1',
          name: 'Dev',
          variables: [
            { key: 'host', value: 'api.example.com', secret: false },
            { key: 'token', value: SECRET, secret: true },
          ],
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
        },
      ],
      activeEnvironmentId: 'e1',
    });
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://{{host}}/users' },
    });
    // Two headers carrying the secret token:
    //   - Authorization (baseline-sensitive) → the capsule serializer
    //     redacts its VALUE to <redacted> (the request-header redaction
    //     layer), so the secret can't leak even before masking.
    //   - X-Custom (NON-sensitive) → the value is NOT header-redacted, so
    //     the env masking is what keeps the secret out: it stays
    //     `Bearer {{token}}` in the capsule source.
    await user.click(screen.getByTestId('http-request-editor-tab-headers'));
    await user.click(screen.getByTestId('http-request-editor-headers-add'));
    await user.click(screen.getByTestId('http-request-editor-headers-add'));
    const nameInputs = screen.getAllByTestId('http-request-editor-header-name');
    const valueInputs = screen.getAllByTestId('http-request-editor-header-value');
    fireEvent.change(nameInputs[0]!, { target: { value: 'Authorization' } });
    fireEvent.change(valueInputs[0]!, { target: { value: 'Bearer {{token}}' } });
    fireEvent.change(nameInputs[1]!, { target: { value: 'X-Custom' } });
    fireEvent.change(valueInputs[1]!, { target: { value: 'Bearer {{token}}' } });
    const reqId = useWorkspaceToolStore.getState().requests[0]!.id;
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalledTimes(1));

    // 1) The OUTBOUND request DID carry the resolved secret in BOTH
    //    headers (it must, to authenticate) — this proves interpolation
    //    happened on the wire request.
    const sent = executeHttpRequestMock.mock.calls[0]?.[0];
    const authHeader = sent.headers.find(
      (h: { name: string }) => h.name === 'Authorization'
    );
    const customHeader = sent.headers.find(
      (h: { name: string }) => h.name === 'X-Custom'
    );
    expect(authHeader.value).toBe(`Bearer ${SECRET}`);
    expect(customHeader.value).toBe(`Bearer ${SECRET}`);

    // 2) The RECORDED response must NOT contain the secret anywhere
    //    (body / header value / finalUrl all scrubbed to <redacted>).
    await waitFor(() => {
      expect(
        useWorkspaceToolStore.getState().responsesByRequestId[reqId]
      ).toBeDefined();
    });
    const recorded =
      useWorkspaceToolStore.getState().responsesByRequestId[reqId]![0]!;
    expect(JSON.stringify(recorded)).not.toContain(SECRET);
    expect(recorded.body).toContain('<redacted>');
    expect(recorded.finalUrl).toContain('<redacted>');
    expect(
      recorded.headers.find((h) => h.name === 'X-Echo')?.value
    ).toBe('<redacted>');

    // 3) The recorded CAPSULE (source + stdout) must NOT carry the secret
    //    ANYWHERE. The masking keeps the token as `{{token}}` on the
    //    non-sensitive X-Custom header; the Authorization value is
    //    additionally header-redacted to <redacted>. stdout is the
    //    scrubbed response body.
    await waitFor(() => {
      expect(useExecutionHistoryStore.getState().latestCapsule()).toBeDefined();
    });
    const capsule = useExecutionHistoryStore.getState().latestCapsule()!;
    expect(JSON.stringify(capsule)).not.toContain(SECRET);
    // The masked placeholder survives on the non-sensitive header.
    expect(capsule.source.content).toContain('X-Custom: Bearer {{token}}');
    // The sensitive header value is redacted (defense in depth).
    expect(capsule.source.content).toContain('Authorization: <redacted>');
    expect(capsule.result.stdout ?? '').not.toContain(SECRET);
  });

  // ---- implementation — Auth-tab interpolation is privacy-critical ----

  it('PRIVACY: a secret in the AUTH Bearer field resolves OUTBOUND but never reaches the response/capsule', async () => {
    const user = userEvent.setup();
    const SECRET = 'sk-live-AUTHTABSECRET';
    // Server echoes the secret back in the body — the scrubber must catch it.
    executeHttpRequestMock.mockResolvedValue({
      version: 1,
      kind: 'success',
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/users',
      finalUrl: 'https://api.example.com/users',
      headers: [{ name: 'X-Echo', value: SECRET, redacted: false }],
      body: `{"echo":"${SECRET}"}`,
      contentType: 'application/json',
      sizeBytes: 40,
      durationMs: 5,
      tooLarge: false,
      redactedHeaders: [],
      recordedAt: '2026-06-16T00:00:00.000Z',
    });
    useWorkspaceToolStore.setState({
      environments: [
        {
          version: 1,
          id: 'e1',
          name: 'Dev',
          variables: [{ id: 'r1', key: 'token', value: SECRET, secret: true }],
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
        },
      ],
      activeEnvironmentId: 'e1',
    });
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://api.example.com/users' },
    });
    // Configure Bearer auth with the SECRET env token via the Auth sub-tab.
    await user.click(screen.getByTestId('http-request-editor-tab-auth'));
    fireEvent.change(screen.getByTestId('http-request-editor-auth-kind'), {
      target: { value: 'bearer' },
    });
    fireEvent.change(
      screen.getByTestId('http-request-editor-auth-bearer-token'),
      { target: { value: '{{token}}' } }
    );
    const reqId = useWorkspaceToolStore.getState().requests[0]!.id;
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalledTimes(1));

    // 1) OUTBOUND: the injected Authorization header DID carry the resolved
    //    secret (it must, to authenticate). `composeRequestHeaders` runs on
    //    the interpolated request, so the auth secret reaches the wire.
    const sent = executeHttpRequestMock.mock.calls[0]?.[0];
    expect(sent.auth?.token).toBe(SECRET);

    // 2) RECORDED response: the echoed secret is scrubbed everywhere.
    await waitFor(() => {
      expect(
        useWorkspaceToolStore.getState().responsesByRequestId[reqId]
      ).toBeDefined();
    });
    const recorded =
      useWorkspaceToolStore.getState().responsesByRequestId[reqId]![0]!;
    expect(JSON.stringify(recorded)).not.toContain(SECRET);
    expect(recorded.body).toContain('<redacted>');

    // 3) CAPSULE: the masked request keeps the auth token as `{{token}}`,
    //    and the Authorization header it derives is baseline-redacted. The
    //    resolved secret appears NOWHERE in the capsule.
    await waitFor(() => {
      expect(useExecutionHistoryStore.getState().latestCapsule()).toBeDefined();
    });
    const capsule = useExecutionHistoryStore.getState().latestCapsule()!;
    expect(JSON.stringify(capsule)).not.toContain(SECRET);
    expect(capsule.source.content).toContain('Authorization: <redacted>');
  });

  it('BLOCKS the send when an AUTH field references an unbound variable', async () => {
    const user = userEvent.setup();
    // Active env that does NOT define {{token}}.
    useWorkspaceToolStore.setState({
      environments: [
        {
          version: 1,
          id: 'e1',
          name: 'Dev',
          variables: [],
          createdAt: '2026-06-16T00:00:00.000Z',
          updatedAt: '2026-06-16T00:00:00.000Z',
        },
      ],
      activeEnvironmentId: 'e1',
    });
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-list-create'));
    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://api.example.com/users' },
    });
    await user.click(screen.getByTestId('http-request-editor-tab-auth'));
    fireEvent.change(screen.getByTestId('http-request-editor-auth-kind'), {
      target: { value: 'bearer' },
    });
    fireEvent.change(
      screen.getByTestId('http-request-editor-auth-bearer-token'),
      { target: { value: '{{token}}' } }
    );
    const reqId = useWorkspaceToolStore.getState().requests[0]!.id;
    await user.click(screen.getByTestId('http-request-editor-send'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    // The unresolved auth var blocks the send — no fetch, nothing recorded.
    expect(executeHttpRequestMock).not.toHaveBeenCalled();
    expect(
      useWorkspaceToolStore.getState().responsesByRequestId[reqId]
    ).toBeUndefined();
    expect(useWorkspaceToolStore.getState().executingRequestId).toBeNull();
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

  // ---- implementation — request chaining (capture response variables) ----

  function seedCaptureRequest() {
    const req = {
      ...createBlankHttpRequest({}),
      id: 'req-login',
      name: 'Login',
      method: 'POST' as const,
      url: 'https://api.example.com/login',
      captures: [
        {
          id: 'cap-1',
          source: 'body-json' as const,
          path: 'data.token',
          targetVariable: 'TOKEN',
          enabled: true,
        },
      ],
    };
    return req;
  }

  const devEnv = (variables: Array<{ key: string; value: string; secret: boolean }>) => ({
    version: 1 as const,
    id: 'e1',
    name: 'Dev',
    variables,
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
  });

  it('captures a JSON body value into the active environment on success', async () => {
    const user = userEvent.setup();
    useWorkspaceToolStore.setState({
      environments: [devEnv([])],
      activeEnvironmentId: 'e1',
      requests: [seedCaptureRequest()],
      activeRequestId: 'req-login',
    });
    executeHttpRequestMock.mockResolvedValue(
      makeResponse({ body: JSON.stringify({ data: { token: 'abc.def' } }) })
    );
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const env = useWorkspaceToolStore
        .getState()
        .environments.find((e) => e.id === 'e1');
      const token = env?.variables.find((v) => v.key === 'TOKEN');
      expect(token?.value).toBe('abc.def');
      // A `TOKEN`-named variable is secret-by-default.
      expect(token?.secret).toBe(true);
    });
  });

  it('updates an existing variable in place rather than duplicating it', async () => {
    const user = userEvent.setup();
    useWorkspaceToolStore.setState({
      environments: [devEnv([{ key: 'TOKEN', value: 'stale', secret: true }])],
      activeEnvironmentId: 'e1',
      requests: [seedCaptureRequest()],
      activeRequestId: 'req-login',
    });
    executeHttpRequestMock.mockResolvedValue(
      makeResponse({ body: JSON.stringify({ data: { token: 'fresh' } }) })
    );
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const env = useWorkspaceToolStore
        .getState()
        .environments.find((e) => e.id === 'e1');
      const tokens = env?.variables.filter((v) => v.key === 'TOKEN') ?? [];
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.value).toBe('fresh');
    });
  });

  it('does not capture on a non-success response', async () => {
    const user = userEvent.setup();
    useWorkspaceToolStore.setState({
      environments: [devEnv([])],
      activeEnvironmentId: 'e1',
      requests: [seedCaptureRequest()],
      activeRequestId: 'req-login',
    });
    executeHttpRequestMock.mockResolvedValue(
      makeResponse({
        kind: 'server-error',
        status: 500,
        body: JSON.stringify({ data: { token: 'leaked' } }),
      })
    );
    render(<HttpWorkspacePanel />);

    await user.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalledTimes(1));

    // Give any (incorrect) async write a chance to land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const env = useWorkspaceToolStore
      .getState()
      .environments.find((e) => e.id === 'e1');
    expect(env?.variables.find((v) => v.key === 'TOKEN')).toBeUndefined();
  });
});
