import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRequestEditor } from '../../../src/renderer/components/HttpWorkspace/HttpRequestEditor';
import type { HttpCaptureTarget } from '../../../src/renderer/components/HttpWorkspace/useHttpTreeCapture';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { useWorkspaceRunReadyStore } from '../../../src/renderer/stores/workspaceRunReadyStore';
import type { HttpEnvironmentV1 } from '../../../src/shared/httpEnvironment';
import { createBlankHttpRequest } from '../../../src/shared/httpWorkspace';

describe('HttpRequestEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches to a WebSocket transport without exposing HTTP-only code generation', () => {
    const request = createBlankHttpRequest({ id: 'r1' });
    const onPatch = vi.fn();
    render(
      <HttpRequestEditor
        request={request}
        onPatch={onPatch}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    fireEvent.change(screen.getByTestId('http-request-editor-transport'), {
      target: { value: 'websocket' },
    });
    expect(
      (screen.getByTestId('http-request-editor-method') as HTMLSelectElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByTestId('http-request-editor-copy-menu') as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getByTestId('http-request-editor-url').getAttribute('placeholder')
    ).toBe('wss://api.example.com/socket');
    act(() => vi.advanceTimersByTime(500));
    expect(onPatch).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({ transport: 'websocket', method: 'GET' })
    );
  });

  it('auto-saves the full draft when edits happen across fields before debounce settles', () => {
    const request = createBlankHttpRequest({
      id: 'r1',
      now: '2026-05-25T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    render(
      <HttpRequestEditor
        request={request}
        onPatch={onPatch}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://api.example.com/users' },
    });
    // Headers live behind the Headers sub-tab in the new builder.
    fireEvent.click(screen.getByTestId('http-request-editor-tab-headers'));
    fireEvent.click(screen.getByTestId('http-request-editor-headers-add'));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: [{ name: '', value: '', enabled: true }],
        body: { kind: 'none' },
      })
    );
  });

  it('flushes the latest draft on unmount before the debounce settles', () => {
    const request = createBlankHttpRequest({
      id: 'r1',
      now: '2026-05-25T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    const { unmount } = render(
      <HttpRequestEditor
        request={request}
        onPatch={onPatch}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://api.example.com/late' },
    });

    unmount();

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        method: 'GET',
        url: 'https://api.example.com/late',
        headers: [],
        body: { kind: 'none' },
      })
    );
  });

  it('sends and persists the latest captures and assertions before debounce settles', () => {
    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      url: 'https://api.example.com/session',
    };
    const onPatch = vi.fn();
    const onSend = vi.fn();

    render(
      <HttpRequestEditor
        request={request}
        onPatch={onPatch}
        onSend={onSend}
        isExecuting={false}
      />
    );

    fireEvent.click(screen.getByTestId('http-request-editor-tab-capture'));
    fireEvent.click(screen.getByTestId('http-request-editor-capture-add'));
    fireEvent.change(screen.getByTestId('http-request-editor-capture-path'), {
      target: { value: 'data.token' },
    });
    fireEvent.change(screen.getByTestId('http-request-editor-capture-target'), {
      target: { value: 'TOKEN' },
    });

    fireEvent.click(screen.getByTestId('http-request-editor-tab-assert'));
    fireEvent.click(screen.getByTestId('http-request-editor-assert-add'));
    fireEvent.change(screen.getByTestId('http-request-editor-assert-expected'), {
      target: { value: '201' },
    });

    fireEvent.click(screen.getByTestId('http-request-editor-send'));

    const expectedLists = expect.objectContaining({
      captures: [
        expect.objectContaining({
          source: 'body-json',
          path: 'data.token',
          targetVariable: 'TOKEN',
          enabled: true,
        }),
      ],
      assertions: [
        expect.objectContaining({
          source: 'status',
          comparator: 'equals',
          expected: '201',
          enabled: true,
        }),
      ],
    });
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith(expectedLists);
    expect(onPatch).toHaveBeenCalledOnce();
    expect(onPatch).toHaveBeenCalledWith('r1', expectedLists);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onPatch).toHaveBeenCalledOnce();
  });

  // RQ-02 — switching the active request inside the 500 ms debounce
  // quiet window must flush the in-flight edit onto the request it was
  // typed into (A), never onto the newly-active request (B).
  it('does not leak an in-flight edit onto the next request when switching within the debounce window', () => {
    const requestA = createBlankHttpRequest({
      id: 'r-a',
      now: '2026-05-25T00:00:00.000Z',
    });
    const requestB = createBlankHttpRequest({
      id: 'r-b',
      now: '2026-05-25T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    const { rerender } = render(
      <HttpRequestEditor
        request={requestA}
        onPatch={onPatch}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    // Type into request A but do NOT let the debounce settle.
    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://api.example.com/a-in-flight' },
    });

    // Switch the active request to B inside the quiet window.
    rerender(
      <HttpRequestEditor
        request={requestB}
        onPatch={onPatch}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    // The switch flushed A's pending edit synchronously, addressed to A.
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith(
      'r-a',
      expect.objectContaining({ url: 'https://api.example.com/a-in-flight' })
    );

    // Draining any residual timer must not produce a patch onto B.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(
      onPatch.mock.calls.some(([id]) => id === 'r-b')
    ).toBe(false);
  });

  // Params <-> URL two-way sync. Editing the URL re-seeds the Params
  // table; editing a param rebuilds the URL bar.
  it('seeds the Params table from a URL with a query string', () => {
    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      url: 'https://x.dev/s?q=hi&page=2',
    };

    render(
      <HttpRequestEditor
        request={request}
        onPatch={vi.fn()}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    // Params is the default sub-tab; the rows reflect the URL query.
    const names = screen
      .getAllByTestId('http-request-editor-param-name')
      .map((el) => (el as HTMLInputElement).value);
    expect(names).toEqual(['q', 'page']);
  });

  it('rebuilds the URL when a param value is edited', () => {
    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      url: 'https://x.dev/s?q=hi',
    };
    const onPatch = vi.fn();

    render(
      <HttpRequestEditor
        request={request}
        onPatch={onPatch}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    fireEvent.change(screen.getAllByTestId('http-request-editor-param-value')[0]!, {
      target: { value: 'bye' },
    });

    // URL bar reflects the new param synchronously.
    expect(
      (screen.getByTestId('http-request-editor-url') as HTMLInputElement).value
    ).toBe('https://x.dev/s?q=bye');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onPatch).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        url: 'https://x.dev/s?q=bye',
        queryParams: [{ key: 'q', value: 'bye', enabled: true }],
      })
    );
  });

  it('re-seeds the Params table when the URL bar is edited', () => {
    const request = createBlankHttpRequest({
      id: 'r1',
      now: '2026-05-25T00:00:00.000Z',
    });

    render(
      <HttpRequestEditor
        request={request}
        onPatch={vi.fn()}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://x.dev/s?token=abc&limit=10' },
    });

    const names = screen
      .getAllByTestId('http-request-editor-param-name')
      .map((el) => (el as HTMLInputElement).value);
    expect(names).toEqual(['token', 'limit']);
  });

  it('copies the request as a cURL command', async () => {
    vi.useRealTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      method: 'GET' as const,
      url: 'https://x.dev/users',
    };

    render(
      <HttpRequestEditor
        request={request}
        onPatch={vi.fn()}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    fireEvent.click(screen.getByTestId('http-request-editor-copy-menu'));
    fireEvent.click(screen.getByTestId('http-request-editor-copy-curl'));

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("curl 'https://x.dev/users'");
    });
  });

  it('copies the request as a fetch snippet from the Copy-as menu', async () => {
    vi.useRealTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      method: 'GET' as const,
      url: 'https://x.dev/users',
    };

    render(
      <HttpRequestEditor
        request={request}
        onPatch={vi.fn()}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    fireEvent.click(screen.getByTestId('http-request-editor-copy-menu'));
    fireEvent.click(screen.getByTestId('http-request-editor-copy-fetch'));

    await vi.waitFor(() => {
      const snippet = writeText.mock.calls[0]?.[0] as string;
      expect(snippet).toContain('await fetch("https://x.dev/users"');
      expect(snippet).toContain('method: "GET"');
    });
  });

  it('keeps bespoke editor actions on the shared focus-ring contract', () => {
    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      url: 'https://x.dev/users',
    };
    const props = {
      request,
      onPatch: vi.fn(),
      onSend: vi.fn(),
    };

    const { rerender } = render(
      <HttpRequestEditor {...props} isExecuting={false} />
    );

    for (const testId of [
      'http-request-editor-copy-menu',
      'http-request-editor-send',
      'http-request-editor-tab-params',
    ]) {
      expect(screen.getByTestId(testId).className).toContain('focus-ring');
    }

    fireEvent.click(screen.getByTestId('http-request-editor-copy-menu'));
    expect(screen.getByTestId('http-request-editor-copy-curl').className).toContain(
      'focus-ring'
    );

    fireEvent.click(screen.getByTestId('http-request-editor-tab-headers'));
    expect(screen.getByTestId('http-request-editor-headers-add').className).toContain(
      'focus-ring'
    );

    rerender(<HttpRequestEditor {...props} isExecuting onStop={vi.fn()} />);
    expect(screen.getByTestId('http-request-editor-stop').className).toContain(
      'focus-ring'
    );
  });

  // Resolution preview + secret-safe cURL.
  it('renders the resolution preview (resolved URL + var chips) with an active env', () => {
    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      method: 'GET' as const,
      url: 'https://{{host}}/{{missing}}',
    };
    render(
      <HttpRequestEditor
        request={request}
        onPatch={vi.fn()}
        onSend={vi.fn()}
        isExecuting={false}
        environments={[
          {
            version: 1,
            id: 'e1',
            name: 'Dev',
            variables: [
              { key: 'host', value: 'api.example.com', secret: false },
              { key: 'token', value: 'sk-SECRET', secret: true },
            ],
            createdAt: '2026-06-16T00:00:00.000Z',
            updatedAt: '2026-06-16T00:00:00.000Z',
          },
        ]}
        activeEnvironmentId="e1"
        onSelectEnvironment={vi.fn()}
        onManageEnvironment={vi.fn()}
      />
    );
    // The selector renders with the active env selected.
    expect(
      (screen.getByTestId('http-environment-selector') as HTMLSelectElement)
        .value
    ).toBe('e1');
    // The resolved URL shows host resolved, missing token kept.
    const previewUrl = screen.getByTestId('http-environment-preview-url');
    expect(previewUrl.textContent).toBe('https://api.example.com/{{missing}}');
    // Unresolved chip for {{missing}}.
    expect(
      screen.getByTestId('http-environment-preview-chip-unresolved').textContent
    ).toContain('missing');
  });

  it('does NOT print a resolved secret value anywhere in the preview (privacy)', () => {
    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      method: 'GET' as const,
      url: 'https://{{host}}/?k={{token}}',
    };
    render(
      <HttpRequestEditor
        request={request}
        onPatch={vi.fn()}
        onSend={vi.fn()}
        isExecuting={false}
        environments={[
          {
            version: 1,
            id: 'e1',
            name: 'Dev',
            variables: [
              { key: 'host', value: 'api.example.com', secret: false },
              { key: 'token', value: 'sk-DO-NOT-LEAK', secret: true },
            ],
            createdAt: '2026-06-16T00:00:00.000Z',
            updatedAt: '2026-06-16T00:00:00.000Z',
          },
        ]}
        activeEnvironmentId="e1"
        onSelectEnvironment={vi.fn()}
        onManageEnvironment={vi.fn()}
      />
    );
    const preview = screen.getByTestId('http-environment-preview');
    expect(preview.textContent ?? '').not.toContain('sk-DO-NOT-LEAK');
    // The secret token stays as `{{token}}` in the resolved URL line.
    expect(
      screen.getByTestId('http-environment-preview-url').textContent
    ).toBe('https://api.example.com/?k={{token}}');
    // A secret chip is shown for the token (key only, value masked).
    expect(
      screen.getByTestId('http-environment-preview-chip-secret').textContent
    ).toContain('token');
  });

  it('Copy as cURL masks env secrets but resolves non-secret vars', async () => {
    vi.useRealTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      method: 'GET' as const,
      url: 'https://{{host}}/users',
    };
    render(
      <HttpRequestEditor
        request={request}
        onPatch={vi.fn()}
        onSend={vi.fn()}
        isExecuting={false}
        environments={[
          {
            version: 1,
            id: 'e1',
            name: 'Dev',
            variables: [
              { key: 'host', value: 'api.example.com', secret: false },
              { key: 'token', value: 'sk-DO-NOT-LEAK', secret: true },
            ],
            createdAt: '2026-06-16T00:00:00.000Z',
            updatedAt: '2026-06-16T00:00:00.000Z',
          },
        ]}
        activeEnvironmentId="e1"
        onSelectEnvironment={vi.fn()}
        onManageEnvironment={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('http-request-editor-copy-menu'));
    fireEvent.click(screen.getByTestId('http-request-editor-copy-curl'));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "curl 'https://api.example.com/users'"
      );
    });
    // Sanity: no secret made it onto the clipboard string.
    expect(writeText.mock.calls[0]?.[0]).not.toContain('sk-DO-NOT-LEAK');
  });

  it('uses the final duplicate binding for secret preview and cURL masking', async () => {
    vi.useRealTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const request = {
      ...createBlankHttpRequest({ id: 'r1', now: '2026-05-25T00:00:00.000Z' }),
      method: 'GET' as const,
      url: 'https://api.example.com/?token={{token}}',
    };
    render(
      <HttpRequestEditor
        request={request}
        onPatch={vi.fn()}
        onSend={vi.fn()}
        isExecuting={false}
        environments={[
          {
            version: 1,
            id: 'e1',
            name: 'Dev',
            variables: [
              { key: 'token', value: 'old-public-value', secret: false },
              { key: 'token', value: 'sk-FINAL-SECRET', secret: true },
            ],
            createdAt: '2026-06-16T00:00:00.000Z',
            updatedAt: '2026-06-16T00:00:00.000Z',
          },
        ]}
        activeEnvironmentId="e1"
        onSelectEnvironment={vi.fn()}
        onManageEnvironment={vi.fn()}
      />
    );
    expect(
      screen.getByTestId('http-environment-preview-url').textContent
    ).toBe('https://api.example.com/?token={{token}}');
    expect(
      screen.getByTestId('http-environment-preview-chip-secret').textContent
    ).toContain('token');

    fireEvent.click(screen.getByTestId('http-request-editor-copy-menu'));
    fireEvent.click(screen.getByTestId('http-request-editor-copy-curl'));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "curl 'https://api.example.com/?token={{token}}'"
      );
    });
    expect(writeText.mock.calls[0]?.[0]).not.toContain('old-public-value');
    expect(writeText.mock.calls[0]?.[0]).not.toContain('sk-FINAL-SECRET');
  });

  describe('URL row', () => {
    const environment: HttpEnvironmentV1 = {
      version: 1,
      id: 'env-1',
      name: 'staging',
      variables: [{ id: 'v1', key: 'base', value: 'https://api.example.com', secret: false }],
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    };
    const editor = (url: string, props: Partial<Parameters<typeof HttpRequestEditor>[0]> = {}) => {
      const onSend = vi.fn();
      render(
        <HttpRequestEditor request={{ ...createBlankHttpRequest({ id: 'r1' }), url }} onPatch={vi.fn()} onSend={onSend} isExecuting={false} {...props} />
      );
      return onSend;
    };
    const send = () => screen.getByTestId('http-request-editor-send') as HTMLButtonElement;
    const hint = () => screen.queryByTestId('http-request-editor-url-hint')?.textContent ?? null;

    it('explains why Send is off and enables it once the URL parses', () => {
      const onSend = editor('');
      expect(send().disabled).toBe(true);
      expect(hint()).toBe('Enter a URL to send.');
      expect(send().getAttribute('aria-describedby')).toBe('http-request-editor-url-hint');
      fireEvent.change(screen.getByTestId('http-request-editor-url'), { target: { value: 'api.example.com/users' } });
      expect(hint()).toBe('Enter a full URL that starts with https:// or http:// to send.');
      fireEvent.keyDown(screen.getByTestId('http-request-editor'), { key: 'Enter', metaKey: true });
      expect(onSend).not.toHaveBeenCalled();
      fireEvent.change(screen.getByTestId('http-request-editor-url'), { target: { value: 'https://api.example.com/users' } });
      expect(hint()).toBeNull();
      expect(send().disabled).toBe(false);
      expect(send().hasAttribute('aria-describedby')).toBe(false);
      fireEvent.click(send());
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('judges a URL after the active environment fills it, and names a missing variable', () => {
      editor('{{base}}/users', { environments: [environment], activeEnvironmentId: 'env-1' });
      expect(send().disabled).toBe(false);
      expect(screen.getByTestId('http-request-editor-url-token').getAttribute('data-state')).toBe('defined');
      fireEvent.change(screen.getByTestId('http-request-editor-url'), { target: { value: '{{host}}/users' } });
      expect(hint()).toBe('Give host a value in the active environment to send.');
      expect(screen.getByTestId('http-request-editor-url-token').getAttribute('data-state')).toBe('missing');
    });

    it('says to pick an environment when none is active', () => {
      editor('{{base}}/users');
      expect(hint()).toBe('Choose an environment that sets base to send.');
    });

    it('asks for a ws:// URL on a WebSocket request', () => {
      editor('https://api.example.com');
      fireEvent.change(screen.getByTestId('http-request-editor-transport'), { target: { value: 'websocket' } });
      expect(hint()).toBe('Enter a full URL that starts with wss:// or ws:// to send.');
    });

    it('blocks toolbar Run while the URL cannot be sent', () => {
      editor('');
      expect(useWorkspaceRunReadyStore.getState().blocked.http).toBe(true);
      fireEvent.change(screen.getByTestId('http-request-editor-url'), { target: { value: 'https://x.dev' } });
      expect(useWorkspaceRunReadyStore.getState().blocked.http).toBe(false);
    });

    it('draws tokens on a layer that scrolls with the input', () => {
      editor('{{base}}/users/{{id}}', { environments: [environment], activeEnvironmentId: 'env-1' });
      const field = screen.getByTestId('http-request-editor-url-field');
      const mirror = screen.getByTestId('http-request-editor-url-mirror');
      expect(field.getAttribute('data-mirrored')).toBe('true');
      expect(mirror.getAttribute('aria-hidden')).toBe('true');
      expect(mirror.textContent).toBe('{{base}}/users/{{id}} ');
      const input = screen.getByTestId('http-request-editor-url');
      input.scrollLeft = 42;
      fireEvent.scroll(input);
      expect(mirror.scrollLeft).toBe(42);
      fireEvent.change(input, { target: { value: 'https://x.dev' } });
      expect(field.getAttribute('data-mirrored')).toBe('false');
      expect(screen.queryByTestId('http-request-editor-url-mirror')).toBeNull();
    });
  });

  it('shows the auth scheme on the Auth tab', () => {
    render(
      <HttpRequestEditor
        request={{ ...createBlankHttpRequest({ id: 'r1' }), auth: { kind: 'apiKey', apiKeyHeader: 'X-Key', apiKeyValue: 'k' } }}
        onPatch={vi.fn()}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );
    expect(screen.getByTestId('http-request-editor-tab-auth').textContent).toBe('AuthAPI key');
  });

  it('adds a body capture rule for a value picked in the response tree, once per path', () => {
    const captureTargetRef = createRef<HttpCaptureTarget | null>() as React.MutableRefObject<HttpCaptureTarget | null>;
    const onPatch = vi.fn();
    render(
      <HttpRequestEditor
        request={{
          ...createBlankHttpRequest({ id: 'r1' }),
          captures: [{ id: 'c0', source: 'body-json', path: 'token', targetVariable: 'id', enabled: true }],
        }}
        onPatch={onPatch}
        onSend={vi.fn()}
        isExecuting={false}
        captureTargetRef={captureTargetRef}
      />
    );
    act(() => captureTargetRef.current?.('items[0].id', ['items', 0, 'id']));
    expect(screen.getByTestId('http-request-editor-tab-capture').getAttribute('data-active')).toBe('true');
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'success',
      messageKey: 'httpWorkspace.editor.capture.added',
      values: { path: 'items[0].id', name: 'id_2' },
    });
    act(() => captureTargetRef.current?.('items.0.id', ['items', 0, 'id']));
    act(() => vi.advanceTimersByTime(500));
    expect(onPatch).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        captures: [
          expect.objectContaining({ path: 'token' }),
          expect.objectContaining({ source: 'body-json', path: 'items[0].id', targetVariable: 'id_2', enabled: true }),
        ],
      })
    );
  });
});
