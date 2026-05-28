/**
 * RL-097 Slice 1 — `workspaceToolStore` CRUD + LRU + active-request
 * lifecycle.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetWorkspaceToolStoreForTests,
  useWorkspaceToolStore,
} from '../../src/renderer/stores/workspaceToolStore';
import {
  createBlankHttpRequest,
  type HttpResponseV1,
} from '../../src/shared/httpWorkspace';

function makeRequest(id: string, name: string) {
  return createBlankHttpRequest({
    id,
    name,
    now: '2026-05-26T00:00:00.000Z',
  });
}

function makeResponse(overrides: Partial<HttpResponseV1> = {}): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    headers: [],
    body: 'body content',
    contentType: 'text/plain',
    sizeBytes: 12,
    durationMs: 42,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('useWorkspaceToolStore (RL-097 Slice 1)', () => {
  beforeEach(() => {
    localStorage.removeItem('lingua-workspace-tool-state');
    resetWorkspaceToolStoreForTests();
  });

  afterEach(() => {
    resetWorkspaceToolStoreForTests();
    localStorage.removeItem('lingua-workspace-tool-state');
  });

  it('createRequest sets activeRequestId to the new request', () => {
    const req = makeRequest('a', 'A');
    useWorkspaceToolStore.getState().createRequest(req);
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe('a');
    expect(useWorkspaceToolStore.getState().requests).toHaveLength(1);
  });

  it('createRequests bulk-appends in order + selects the first (RL-100 Slice 3)', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('existing', 'E'));
    useWorkspaceToolStore
      .getState()
      .createRequests([makeRequest('a', 'A'), makeRequest('b', 'B')]);
    const { requests, activeRequestId } = useWorkspaceToolStore.getState();
    expect(requests.map((r) => r.id)).toEqual(['a', 'b', 'existing']);
    expect(activeRequestId).toBe('a');
  });

  it('createRequests is a no-op for an empty array', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    useWorkspaceToolStore.getState().createRequests([]);
    expect(useWorkspaceToolStore.getState().requests).toHaveLength(1);
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe('a');
  });

  it('updateRequest patches existing fields + bumps updatedAt', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    useWorkspaceToolStore
      .getState()
      .updateRequest('a', { url: 'https://example.org/' });
    const updated = useWorkspaceToolStore.getState().requests[0];
    expect(updated?.url).toBe('https://example.org/');
    expect(updated?.updatedAt).not.toBe('2026-05-26T00:00:00.000Z');
  });

  it('updateRequest preserves version + id pin', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    useWorkspaceToolStore
      .getState()
      // @ts-expect-error — testing the defensive pin
      .updateRequest('a', { version: 99, id: 'hijacked' });
    const updated = useWorkspaceToolStore.getState().requests[0];
    expect(updated?.version).toBe(1);
    expect(updated?.id).toBe('a');
  });

  it('deleteRequest removes the request + its history + shifts active id', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    useWorkspaceToolStore.getState().createRequest(makeRequest('b', 'B'));
    useWorkspaceToolStore.getState().recordResponse('a', makeResponse());
    useWorkspaceToolStore.getState().setActiveRequest('a');
    useWorkspaceToolStore.getState().deleteRequest('a');
    expect(
      useWorkspaceToolStore.getState().requests.find((r) => r.id === 'a')
    ).toBeUndefined();
    expect(
      useWorkspaceToolStore.getState().responsesByRequestId['a']
    ).toBeUndefined();
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe('b');
  });

  it('recordResponse stores newest at index 0', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    const first = makeResponse({ status: 200 });
    const second = makeResponse({ status: 404, kind: 'client-error' });
    useWorkspaceToolStore.getState().recordResponse('a', first);
    useWorkspaceToolStore.getState().recordResponse('a', second);
    const list = useWorkspaceToolStore.getState().responsesByRequestId['a'];
    expect(list?.[0]?.status).toBe(404);
    expect(list?.[1]?.status).toBe(200);
  });

  it('recordResponse ignores deleted or unknown request ids', () => {
    const before = useWorkspaceToolStore.getState();
    useWorkspaceToolStore.getState().recordResponse('missing', makeResponse());
    expect(useWorkspaceToolStore.getState()).toBe(before);
    expect(
      useWorkspaceToolStore.getState().responsesByRequestId['missing']
    ).toBeUndefined();
  });

  it('recordResponse strips body from previous entries (only latest keeps body)', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    useWorkspaceToolStore
      .getState()
      .recordResponse('a', makeResponse({ body: 'first response body' }));
    useWorkspaceToolStore
      .getState()
      .recordResponse('a', makeResponse({ body: 'second response body' }));
    const list = useWorkspaceToolStore.getState().responsesByRequestId['a'];
    expect(list?.[0]?.body).toBe('second response body');
    expect(list?.[1]?.body).toBe('');
    expect(list?.[1]?.tooLarge).toBe(false);
  });

  it('recordResponse caps the LRU at 10 entries', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    for (let i = 0; i < 15; i += 1) {
      useWorkspaceToolStore
        .getState()
        .recordResponse('a', makeResponse({ status: 200 + i }));
    }
    const list = useWorkspaceToolStore.getState().responsesByRequestId['a'];
    expect(list).toHaveLength(10);
    expect(list?.[0]?.status).toBe(214);
  });

  it('clearHistory drops the response list for a request', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    useWorkspaceToolStore.getState().recordResponse('a', makeResponse());
    useWorkspaceToolStore.getState().clearHistory('a');
    expect(
      useWorkspaceToolStore.getState().responsesByRequestId['a']
    ).toBeUndefined();
  });

  it('setActiveRequest resets isExecutingActive on switch', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    useWorkspaceToolStore.getState().createRequest(makeRequest('b', 'B'));
    // `createRequest('b')` set activeRequestId = 'b'; the
    // `setIsExecutingActive(true)` then flips the run flag. Now
    // switching to 'a' must reset the flag (different request).
    useWorkspaceToolStore.getState().setIsExecutingActive(true);
    useWorkspaceToolStore.getState().setActiveRequest('a');
    expect(useWorkspaceToolStore.getState().isExecutingActive).toBe(false);
  });

  it('setIsExecutingActive flips the flag without re-rendering on no-op', () => {
    const before = useWorkspaceToolStore.getState();
    useWorkspaceToolStore.getState().setIsExecutingActive(false);
    expect(useWorkspaceToolStore.getState()).toBe(before);
    useWorkspaceToolStore.getState().setIsExecutingActive(true);
    expect(useWorkspaceToolStore.getState().isExecutingActive).toBe(true);
  });

  it('getLatestResponse returns the most-recent response', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    useWorkspaceToolStore
      .getState()
      .recordResponse('a', makeResponse({ status: 500 }));
    expect(useWorkspaceToolStore.getState().getLatestResponse('a')?.status).toBe(
      500
    );
  });
});
