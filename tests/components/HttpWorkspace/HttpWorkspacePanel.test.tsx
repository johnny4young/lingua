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
import { useUIStore } from '../../../src/renderer/stores/uiStore';
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
    useSettingsStore.setState({
      sensitiveHttpHeaders: [],
      httpAllowPrivateHosts: false,
    });
    executeHttpRequestMock.mockReset();
    executeHttpRequestMock.mockResolvedValue(makeResponse());
    useAnnouncerStore.setState({ message: '', nonce: 0 });
  });

  it('renders live stream progress before recording the settled response', async () => {
    const user = userEvent.setup();
    executeHttpRequestMock.mockImplementation(async (_request, options) => {
      options?.onProgress?.({
        body: 'data: ready\n\n',
        sizeBytes: 13,
        messageCount: 1,
        opened: true,
      });
      await Promise.resolve();
      return makeResponse({
        transport: 'sse',
        contentType: 'text/event-stream',
        body: 'data: ready\n\n',
        messageCount: 1,
      });
    });
    render(<HttpWorkspacePanel />);
    await user.click(screen.getByTestId('http-request-list-create'));
    await user.selectOptions(
      screen.getByTestId('http-request-editor-transport'),
      'sse'
    );
    await user.type(
      screen.getByTestId('http-request-editor-url'),
      'https://api.example.com/events'
    );
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() =>
      expect(screen.getByText('data: ready', { exact: false })).not.toBeNull()
    );
    expect(executeHttpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ transport: 'sse' }),
      expect.objectContaining({ allowPrivateHosts: false })
    );
  });

  it('redacts active environment secrets from the live stream preview', async () => {
    const user = userEvent.setup();
    const secret = 'stream-secret-value';
    let settle!: (response: HttpResponseV1) => void;
    executeHttpRequestMock.mockImplementation((_request, options) => {
      options?.onProgress?.({
        body: `data: ${secret}\n\n`,
        sizeBytes: secret.length,
        messageCount: 1,
        opened: true,
      });
      return new Promise<HttpResponseV1>((resolve) => {
        settle = resolve;
      });
    });
    useWorkspaceToolStore.setState({
      environments: [
        {
          version: 1,
          id: 'env-1',
          name: 'Dev',
          variables: [
            { id: 'variable-1', key: 'TOKEN', value: secret, secret: true },
          ],
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      activeEnvironmentId: 'env-1',
    });
    render(<HttpWorkspacePanel />);
    await user.click(screen.getByTestId('http-request-list-create'));
    await user.selectOptions(
      screen.getByTestId('http-request-editor-transport'),
      'sse'
    );
    await user.type(
      screen.getByTestId('http-request-editor-url'),
      'https://api.example.com/events'
    );
    await user.click(screen.getByTestId('http-request-editor-send'));

    await waitFor(() => expect(screen.getByText(/<redacted>/)).not.toBeNull());
    expect(document.body.textContent).not.toContain(secret);
    settle(makeResponse({ transport: 'sse', body: 'done' }));
  });

  it('runs HTTP pipeline steps sequentially and skips the tail after failure', async () => {
    const user = userEvent.setup();
    const store = useWorkspaceToolStore.getState();
    const requests = ['one', 'two', 'three'].map((id) => ({
      ...createBlankHttpRequest({ id, name: id }),
      url: `https://api.example.com/${id}`,
    }));
    store.createRequests(requests);
    store.createHttpPipeline({
      version: 1,
      id: 'pipeline-1',
      name: 'Failure flow',
      steps: requests.map((request, index) => ({
        id: `step-${index}`,
        requestId: request.id,
        enabled: true,
      })),
      stopOnFailure: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    executeHttpRequestMock
      .mockResolvedValueOnce(makeResponse())
      .mockResolvedValueOnce(
        makeResponse({ kind: 'server-error', status: 500, statusText: 'Error' })
      );
    render(<HttpWorkspacePanel />);
    await user.click(screen.getByTestId('http-pipeline-open'));
    await user.click(screen.getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Skipped')).not.toBeNull());
    expect(screen.getByText('Pipeline finished with failures.')).not.toBeNull();
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

  it('labels the HTTP capsule desktop when the preload reports an OS platform', async () => {
    (window as unknown as { lingua?: unknown }).lingua = { platform: 'darwin' };
    try {
      const user = userEvent.setup();
      render(<HttpWorkspacePanel />);
      await user.click(screen.getByTestId('http-request-list-create'));
      await user.type(
        screen.getByTestId('http-request-editor-url'),
        'https://api.example.com/users'
      );
      await user.click(screen.getByTestId('http-request-editor-send'));
      await waitFor(() => {
        expect(
          useExecutionHistoryStore.getState().latestCapsule()?.environment.platform
        ).toBe('desktop');
      });
    } finally {
      delete (window as unknown as { lingua?: unknown }).lingua;
    }
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

  // ---- Environment interpolation + secret redaction ----

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

  // ---- Auth-tab interpolation is privacy-critical ----

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

  // ---- Request chaining (capture response variables) ----

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

describe('HttpWorkspacePanel — variable scopes', () => {
  const NOW = '2026-10-25T00:00:00.000Z';
  const envOf = (id: string, name: string, variables: Array<{ key: string; value: string; secret?: boolean }>) => ({
    version: 1 as const,
    id,
    name,
    variables: variables.map((variable, index) => ({ id: `${id}-${index}`, secret: false, ...variable })),
    createdAt: NOW,
    updatedAt: NOW,
  });

  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceToolStoreForTests();
    useSettingsStore.setState({ sensitiveHttpHeaders: [], httpAllowPrivateHosts: false, featureFlags: { httpScopes: true } });
    useUIStore.setState({ statusNotice: null });
    executeHttpRequestMock.mockReset();
    executeHttpRequestMock.mockResolvedValue(makeResponse());
  });

  async function sendUrl(url: string) {
    const user = userEvent.setup();
    render(<HttpWorkspacePanel />);
    await user.click(screen.getByTestId('http-request-list-create'));
    fireEvent.change(screen.getByTestId('http-request-editor-url'), { target: { value: url } });
    return user;
  }

  it('sends with request over environment over collection', async () => {
    useWorkspaceToolStore.setState({
      environments: [envOf('e1', 'staging', [{ key: 'base', value: 'https://staging.example' }, { key: 'repo', value: 'env-repo' }])],
      activeEnvironmentId: 'e1',
      collectionVariables: [
        { id: 'c1', key: 'base', value: 'https://collection.example', secret: false },
        { id: 'c2', key: 'owner', value: 'octocat', secret: false },
      ],
    });
    const user = await sendUrl('{{base}}/repos/{{owner}}/{{repo}}');
    const id = useWorkspaceToolStore.getState().requests[0]!.id;
    useWorkspaceToolStore.getState().updateRequestVariables(id, () => [{ id: 'r1', key: 'repo', value: 'lingua', secret: false }]);
    await user.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(executeHttpRequestMock).toHaveBeenCalled());
    expect(executeHttpRequestMock.mock.calls[0]![0].url).toBe('https://staging.example/repos/octocat/lingua');
  });

  it('ignores the new scopes with the flag off', async () => {
    useSettingsStore.setState({ featureFlags: {} });
    useWorkspaceToolStore.setState({ collectionVariables: [{ id: 'c1', key: 'owner', value: 'octocat', secret: false }] });
    const user = await sendUrl('https://api.example.com/{{owner}}');
    await user.click(screen.getByTestId('http-request-editor-send'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executeHttpRequestMock).not.toHaveBeenCalled();
  });

  const twoEnvironments = () =>
    useWorkspaceToolStore.setState({
      environments: [
        envOf('prod', 'prod', [{ key: 'base', value: 'https://api.example.com' }]),
        envOf('staging', 'staging', [{ key: 'pageSize', value: '50' }, { key: 'token', value: 'stg-secret', secret: true }]),
      ],
      activeEnvironmentId: 'prod',
    });
  const prodRows = () =>
    useWorkspaceToolStore
      .getState()
      .environments.find((env) => env.id === 'prod')!
      .variables.map(({ key, value, secret }) => ({ key, value, secret }));

  it('offers Add to the active environment under the URL when another one defines the missing value', async () => {
    twoEnvironments();
    const user = await sendUrl('{{base}}/repos?per_page={{pageSize}}');
    expect(screen.getByTestId('http-request-editor-send').hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByTestId('http-request-editor-url-hint-add'));
    expect(prodRows()).toEqual([
      { key: 'base', value: 'https://api.example.com', secret: false },
      { key: 'pageSize', value: '50', secret: false },
    ]);
    await waitFor(() => expect(screen.getByTestId('http-request-editor-send').hasAttribute('disabled')).toBe(false));
  });

  it('offers Add to in the blocked-send notice, bringing a secret as its key and opening it to fill in', async () => {
    twoEnvironments();
    const seeded = {
      ...createBlankHttpRequest({ id: 'h1', now: NOW }),
      url: '{{base}}/repos',
      headers: [{ name: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
    };
    useWorkspaceToolStore.getState().createRequest(seeded);
    const user = userEvent.setup();
    render(<HttpWorkspacePanel />);
    await user.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(useUIStore.getState().statusNotice?.actions).toHaveLength(1));
    const action = useUIStore.getState().statusNotice!.actions![0]!;
    expect(action).toMatchObject({ labelKey: 'httpWorkspace.environment.unresolved.addTo', labelValues: { env: 'prod' } });
    expect(executeHttpRequestMock).not.toHaveBeenCalled();
    action.onClick();
    expect(prodRows()).toContainEqual({ key: 'token', value: '', secret: true });
    expect(JSON.stringify(useWorkspaceToolStore.getState().environments.find((env) => env.id === 'prod'))).not.toContain('stg-secret');
    await waitFor(() => expect(document.activeElement?.getAttribute('type')).toBe('password'));
    expect(screen.getByTestId('http-environment-manager')).toBeTruthy();
  });
});

describe('HttpWorkspacePanel — chain tags', () => {
  const NOW = '2026-10-25T00:00:00.000Z';
  const API = 'https://api.example.com';
  const source = {
    ...createBlankHttpRequest({ id: 'src', now: NOW }),
    name: 'List repos',
    url: `${API}/users/octocat/repos`,
    captures: [{ id: 'cap', source: 'body-json' as const, path: '[0].owner.login', targetVariable: 'owner', enabled: true }],
  };
  const target = { ...createBlankHttpRequest({ id: 'tgt', now: NOW }), name: 'Get repo', url: `${API}/repos/{{owner}}/lingua` };
  const repos = (login: string, extra: Partial<HttpResponseV1> = {}) => makeResponse({ body: JSON.stringify([{ owner: { login } }]), ...extra });

  function seed(rules?: Record<string, 'last' | 'source-first' | 'stale'>, sourceFirst?: HttpResponseV1) {
    useWorkspaceToolStore.setState({
      requests: [{ ...target, ...(rules ? { chainRules: rules } : {}) }, source],
      activeRequestId: 'tgt',
      responsesByRequestId: { src: [repos('recorded', { recordedAt: new Date().toISOString() })] },
    });
    executeHttpRequestMock.mockImplementation(async (outbound: { url: string }) =>
      outbound.url.endsWith('/users/octocat/repos') ? (sourceFirst ?? repos('fresh')) : makeResponse({ url: outbound.url })
    );
  }
  const sentUrls = () => executeHttpRequestMock.mock.calls.map((call) => (call[0] as { url: string }).url);

  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceToolStoreForTests();
    useSettingsStore.setState({ sensitiveHttpHeaders: [], httpAllowPrivateHosts: false, featureFlags: { httpChainTags: true } });
    useUIStore.setState({ statusNotice: null });
    executeHttpRequestMock.mockReset();
  });

  it('reads a tag from the source last response without sending it', async () => {
    seed();
    render(<HttpWorkspacePanel />);
    await userEvent.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(sentUrls()).toEqual([`${API}/repos/recorded/lingua`]));
  });

  it('sends the source first when the tag says so, then uses its fresh value', async () => {
    seed({ owner: 'source-first' });
    render(<HttpWorkspacePanel />);
    await userEvent.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(sentUrls()).toEqual([`${API}/users/octocat/repos`, `${API}/repos/fresh/lingua`]));
  });

  it('lets Send through when the tag has no value yet but sends its source first', async () => {
    seed({ owner: 'source-first' });
    useWorkspaceToolStore.setState({ responsesByRequestId: {} });
    render(<HttpWorkspacePanel />);
    expect(screen.getByTestId('http-request-editor-send').hasAttribute('disabled')).toBe(false);
    await userEvent.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(sentUrls()).toEqual([`${API}/users/octocat/repos`, `${API}/repos/fresh/lingua`]));
  });

  it('keeps Send off while a Use last response tag has no value', () => {
    seed();
    useWorkspaceToolStore.setState({ responsesByRequestId: {} });
    render(<HttpWorkspacePanel />);
    expect(screen.getByTestId('http-request-editor-send').hasAttribute('disabled')).toBe(true);
  });

  it('stops the chain on a source response outside 2xx', async () => {
    seed({ owner: 'source-first' }, repos('moved', { status: 301, statusText: 'Moved' }));
    render(<HttpWorkspacePanel />);
    await userEvent.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() =>
      expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'httpWorkspace.chain.stopped', values: { name: 'List repos', status: '301' } })
    );
    expect(sentUrls()).toEqual([`${API}/users/octocat/repos`]);
  });

  it('refuses a chain whose tags form a cycle', async () => {
    seed({ owner: 'source-first' });
    useWorkspaceToolStore.setState((state) => ({
      requests: state.requests.map((request) =>
        request.id === 'src'
          ? { ...request, url: `${API}/users/{{repoName}}/repos` }
          : { ...request, captures: [{ id: 'c2', source: 'body-json' as const, path: 'name', targetVariable: 'repoName', enabled: true }] }
      ),
    }));
    render(<HttpWorkspacePanel />);
    await userEvent.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'httpWorkspace.chain.cycle' }));
    expect(executeHttpRequestMock).not.toHaveBeenCalled();
  });

  it('runs every source from the derived view, whatever the tag rule', async () => {
    seed();
    render(<HttpWorkspacePanel />);
    expect(screen.getAllByTestId('http-chain-node').map((node) => node.dataset.request)).toEqual(['src', 'tgt']);
    await userEvent.click(screen.getByTestId('http-chain-run'));
    await waitFor(() => expect(sentUrls()).toEqual([`${API}/users/octocat/repos`, `${API}/repos/fresh/lingua`]));
  });

  it('runs the chain even while a Use last response tag has no value yet', async () => {
    seed();
    useWorkspaceToolStore.setState({ responsesByRequestId: {} });
    render(<HttpWorkspacePanel />);
    await userEvent.click(screen.getByTestId('http-chain-run'));
    await waitFor(() => expect(sentUrls()).toEqual([`${API}/users/octocat/repos`, `${API}/repos/fresh/lingua`]));
  });

  it('runs one chain at a time, with Send turned into Stop while its sources go out', async () => {
    seed({ owner: 'source-first' });
    let release: () => void = () => undefined;
    executeHttpRequestMock.mockImplementation(async (outbound: { url: string }) => {
      if (outbound.url.endsWith('/users/octocat/repos')) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return repos('fresh');
      }
      return makeResponse({ url: outbound.url });
    });
    render(<HttpWorkspacePanel />);
    // Two clicks in one tick reach the panel before React re-renders Send as Stop.
    const sendButton = screen.getByTestId('http-request-editor-send');
    fireEvent.click(sendButton);
    fireEvent.click(screen.getByTestId('http-chain-run'));
    await waitFor(() => expect(screen.queryByTestId('http-request-editor-stop')).not.toBeNull());
    release();
    await waitFor(() => expect(sentUrls()).toEqual([`${API}/users/octocat/repos`, `${API}/repos/fresh/lingua`]));
    expect(useUIStore.getState().statusNotice).toBeNull();
  });

  it('reports a stopped chain as information, not an error', async () => {
    seed({ owner: 'source-first' });
    // Like the real client, the source settles only when Stop aborts it, and never throws.
    executeHttpRequestMock.mockImplementation(
      (_outbound, options: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          options.signal.addEventListener('abort', () => resolve(makeResponse({ kind: 'network-error', status: 0, statusText: '' })));
        })
    );
    render(<HttpWorkspacePanel />);
    await userEvent.click(screen.getByTestId('http-request-editor-send'));
    await userEvent.click(await screen.findByTestId('http-request-editor-stop'));
    await waitFor(() => expect(useUIStore.getState().statusNotice).toMatchObject({ tone: 'info', messageKey: 'httpWorkspace.chain.stopped' }));
  });

  it('does not read a response recorded under another environment', () => {
    seed();
    const env = (id: string) => ({ version: 1 as const, id, name: id, variables: [], createdAt: NOW, updatedAt: NOW });
    useWorkspaceToolStore.setState({
      environments: [env('prod'), env('stg')],
      activeEnvironmentId: 'prod',
      responsesByRequestId: { src: [repos('staging-owner', { environmentId: 'stg' })] },
    });
    render(<HttpWorkspacePanel />);
    expect(screen.getByTestId('http-request-editor-send').hasAttribute('disabled')).toBe(true);
  });

  it('records the active environment on each response', async () => {
    seed();
    useWorkspaceToolStore.setState({
      environments: [{ version: 1 as const, id: 'prod', name: 'prod', variables: [], createdAt: NOW, updatedAt: NOW }],
      activeEnvironmentId: 'prod',
      responsesByRequestId: { src: [repos('owner', { environmentId: 'prod' })] },
    });
    render(<HttpWorkspacePanel />);
    await userEvent.click(screen.getByTestId('http-request-editor-send'));
    await waitFor(() => expect(useWorkspaceToolStore.getState().responsesByRequestId.tgt?.[0]?.environmentId).toBe('prod'));
  });

  describe('a host that comes from the chain', () => {
    const next = { ...source, captures: [{ id: 'cap', source: 'body-json' as const, path: 'next', targetVariable: 'nextBase', enabled: true }] };
    const follow = { ...target, url: '{{nextBase}}/items', chainRules: { nextBase: 'source-first' as const } };
    function seedHost() {
      useWorkspaceToolStore.setState({ requests: [follow, next], activeRequestId: 'tgt', responsesByRequestId: {} });
      executeHttpRequestMock.mockImplementation(async (outbound: { url: string }) =>
        outbound.url.endsWith('/users/octocat/repos') ? makeResponse({ body: JSON.stringify({ next: 'https://other.example' }) }) : makeResponse({ url: outbound.url })
      );
    }

    it('waits for the user to confirm the host before sending', async () => {
      seedHost();
      render(<HttpWorkspacePanel />);
      await userEvent.click(screen.getByTestId('http-request-editor-send'));
      await waitFor(() =>
        expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'httpWorkspace.chain.confirm', values: { name: 'Get repo', origin: 'https://other.example' } })
      );
      expect(sentUrls()).toEqual([`${API}/users/octocat/repos`]);
      const action = useUIStore.getState().statusNotice!.actions![0]!;
      useUIStore.getState().dismissStatusNotice('cta');
      action.onClick();
      await waitFor(() => expect(sentUrls()).toEqual([`${API}/users/octocat/repos`, 'https://other.example/items']));
    });

    it('does not send when the confirmation is dismissed', async () => {
      seedHost();
      render(<HttpWorkspacePanel />);
      await userEvent.click(screen.getByTestId('http-request-editor-send'));
      await waitFor(() => expect(useUIStore.getState().statusNotice?.messageKey).toBe('httpWorkspace.chain.confirm'));
      useUIStore.getState().dismissStatusNotice('manual');
      await waitFor(() => expect(useUIStore.getState().statusNotice).toMatchObject({ tone: 'info', messageKey: 'httpWorkspace.chain.stopped' }));
      expect(sentUrls()).toEqual([`${API}/users/octocat/repos`]);
    });

    it('cancels the confirmation with Stop', async () => {
      seedHost();
      render(<HttpWorkspacePanel />);
      await userEvent.click(screen.getByTestId('http-request-editor-send'));
      await waitFor(() => expect(useUIStore.getState().statusNotice?.messageKey).toBe('httpWorkspace.chain.confirm'));
      await userEvent.click(screen.getByTestId('http-request-editor-stop'));
      await waitFor(() => expect(useUIStore.getState().statusNotice?.messageKey).toBe('httpWorkspace.chain.stopped'));
      expect(sentUrls()).toEqual([`${API}/users/octocat/repos`]);
    });

    it('asks nothing when the host was already visible', async () => {
      useWorkspaceToolStore.setState({ requests: [{ ...follow, chainRules: {} }, next], activeRequestId: 'tgt', responsesByRequestId: { src: [makeResponse({ body: JSON.stringify({ next: 'https://other.example' }) })] } });
      executeHttpRequestMock.mockResolvedValue(makeResponse());
      render(<HttpWorkspacePanel />);
      await userEvent.click(screen.getByTestId('http-request-editor-send'));
      await waitFor(() => expect(sentUrls()).toEqual(['https://other.example/items']));
      expect(useUIStore.getState().statusNotice?.messageKey).not.toBe('httpWorkspace.chain.confirm');
    });
  });

  it('leaves tags alone with the flag off', async () => {
    useSettingsStore.setState({ featureFlags: {} });
    seed({ owner: 'source-first' });
    render(<HttpWorkspacePanel />);
    expect(screen.queryByTestId('http-chain')).toBeNull();
    expect(screen.getByTestId('http-request-editor-send').hasAttribute('disabled')).toBe(true);
  });
});

describe('HttpWorkspacePanel — snapshot assertions', () => {
  const NOW = '2026-10-25T00:00:00.000Z';
  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceToolStoreForTests();
    useSettingsStore.setState({ sensitiveHttpHeaders: [], httpAllowPrivateHosts: false, featureFlags: { httpSnapshots: true } });
    executeHttpRequestMock.mockReset();
  });

  it('adds a suggested assertion to the request draft and opens Tests', async () => {
    const request = { ...createBlankHttpRequest({ id: 'r1', now: NOW }), name: 'Repo', url: 'https://api.example.com/repo' };
    useWorkspaceToolStore.setState({ requests: [request], activeRequestId: 'r1', responsesByRequestId: { r1: [makeResponse({ body: '{"name":"janusly"}' })] } });
    render(<HttpWorkspacePanel />);
    await userEvent.click(screen.getAllByTestId('http-response-suggestion')[0]!);
    expect(screen.getByTestId('http-request-editor-tab-assert').dataset.active).toBe('true');
    expect(screen.getByTestId('http-request-editor-tab-assert').textContent).toBe('Tests1');
    await waitFor(() => expect(useWorkspaceToolStore.getState().requests[0]?.assertions).toHaveLength(1));
  });

  it('offers the snapshot only on the newest response, whose body is kept', async () => {
    const snapshot = { version: 1 as const, status: 200, body: '{"stars":12}', recordedAt: NOW, scrubbers: { timestamps: true, uuids: true, ids: true, hostname: false, regex: '' } };
    const request = { ...createBlankHttpRequest({ id: 'r1', now: NOW }), url: 'https://api.example.com/repo', snapshot };
    useWorkspaceToolStore.setState({
      requests: [request],
      activeRequestId: 'r1',
      responsesByRequestId: { r1: [makeResponse({ body: '{"stars":12}' }), makeResponse({ body: '' })] },
    });
    render(<HttpWorkspacePanel />);
    expect(screen.getByTestId('http-response-snapshot-row').dataset.pass).toBe('true');
    await userEvent.click(screen.getAllByTestId('http-response-history-row')[1]!);
    expect(screen.queryByTestId('http-response-snapshot-row')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Snapshot' })).toBeNull();
  });

  it('fails a pipeline step whose response differs from its snapshot', async () => {
    const user = userEvent.setup();
    const store = useWorkspaceToolStore.getState();
    const snapshot = { version: 1 as const, status: 200, body: '{"stars":12}', recordedAt: NOW, scrubbers: { timestamps: true, uuids: true, ids: true, hostname: false, regex: '' } };
    const requests = ['one', 'two'].map((id) => ({ ...createBlankHttpRequest({ id, name: id }), url: `https://api.example.com/${id}` }));
    store.createRequests([{ ...requests[0]!, snapshot }, requests[1]!]);
    store.createHttpPipeline({
      version: 1,
      id: 'p',
      name: 'Snapshot flow',
      steps: requests.map((request, index) => ({ id: `s${index}`, requestId: request.id, enabled: true })),
      stopOnFailure: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    executeHttpRequestMock.mockResolvedValue(makeResponse({ body: '{"stars":14}' }));
    render(<HttpWorkspacePanel />);
    await user.click(screen.getByTestId('http-pipeline-open'));
    await user.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(screen.getByText('Pipeline finished with failures.')).not.toBeNull());
    expect(executeHttpRequestMock).toHaveBeenCalledTimes(1);
  });
});

