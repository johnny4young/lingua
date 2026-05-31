import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRequestEditor } from '../../../src/renderer/components/HttpWorkspace/HttpRequestEditor';
import { createBlankHttpRequest } from '../../../src/shared/httpWorkspace';

describe('HttpRequestEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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

    fireEvent.click(screen.getByTestId('http-request-editor-copy-curl'));

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("curl 'https://x.dev/users'");
    });
  });
});
