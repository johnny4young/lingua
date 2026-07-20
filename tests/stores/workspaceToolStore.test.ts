/**
 * implementation — `workspaceToolStore` CRUD + LRU + active-request
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
import { createBlankHttpEnvironment } from '../../src/shared/httpEnvironment';

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

describe('useWorkspaceToolStore ', () => {
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

  it('createRequests bulk-appends in order + selects the first ', () => {
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

  it('setActiveRequest does NOT clear executingRequestId (per-request model)', () => {
    useWorkspaceToolStore.getState().createRequest(makeRequest('a', 'A'));
    useWorkspaceToolStore.getState().createRequest(makeRequest('b', 'B'));
    // 'b' is executing. Switching to 'a' must leave 'b' as the executing
    // request — the old reset-on-switch was the source of the
    // stale-settle-clobbers-newer-send race.
    useWorkspaceToolStore.getState().setExecutingRequestId('b');
    useWorkspaceToolStore.getState().setActiveRequest('a');
    expect(useWorkspaceToolStore.getState().executingRequestId).toBe('b');
    expect(useWorkspaceToolStore.getState().activeRequestId).toBe('a');
  });

  it('setExecutingRequestId sets the id without re-rendering on no-op', () => {
    const before = useWorkspaceToolStore.getState();
    useWorkspaceToolStore.getState().setExecutingRequestId(null);
    expect(useWorkspaceToolStore.getState()).toBe(before);
    useWorkspaceToolStore.getState().setExecutingRequestId('a');
    expect(useWorkspaceToolStore.getState().executingRequestId).toBe('a');
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

describe('useWorkspaceToolStore environments ', () => {
  beforeEach(() => {
    localStorage.removeItem('lingua-workspace-tool-state');
    resetWorkspaceToolStoreForTests();
  });

  afterEach(() => {
    resetWorkspaceToolStoreForTests();
    localStorage.removeItem('lingua-workspace-tool-state');
  });

  function makeEnv(id: string, name: string) {
    return createBlankHttpEnvironment({
      id,
      name,
      now: '2026-06-16T00:00:00.000Z',
    });
  }

  it('defaults environments to [] and activeEnvironmentId to null', () => {
    expect(useWorkspaceToolStore.getState().environments).toEqual([]);
    expect(useWorkspaceToolStore.getState().activeEnvironmentId).toBeNull();
  });

  it('createEnvironment appends without auto-activating', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    expect(useWorkspaceToolStore.getState().environments).toHaveLength(1);
    expect(useWorkspaceToolStore.getState().activeEnvironmentId).toBeNull();
  });

  it('updateEnvironment patches variables + bumps updatedAt, preserving version/id', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    useWorkspaceToolStore.getState().updateEnvironment('e1', {
      // @ts-expect-error — defensive pin test
      version: 99,
      // @ts-expect-error — defensive pin test
      id: 'hijacked',
      variables: [{ key: 'host', value: 'x', secret: true }],
    });
    const updated = useWorkspaceToolStore.getState().environments[0];
    expect(updated?.version).toBe(1);
    expect(updated?.id).toBe('e1');
    expect(updated?.variables).toEqual([
      { key: 'host', value: 'x', secret: true },
    ]);
    expect(updated?.updatedAt).not.toBe('2026-06-16T00:00:00.000Z');
  });

  it('setActiveEnvironment + getActiveEnvironment resolve the active env', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    useWorkspaceToolStore.getState().setActiveEnvironment('e1');
    expect(useWorkspaceToolStore.getState().getActiveEnvironment()?.id).toBe(
      'e1'
    );
    useWorkspaceToolStore.getState().setActiveEnvironment(null);
    expect(useWorkspaceToolStore.getState().getActiveEnvironment()).toBeUndefined();
  });

  it('deleteEnvironment repoints active to null when the active env is deleted', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e2', 'Prod'));
    useWorkspaceToolStore.getState().setActiveEnvironment('e1');
    useWorkspaceToolStore.getState().deleteEnvironment('e1');
    expect(
      useWorkspaceToolStore.getState().environments.map((e) => e.id)
    ).toEqual(['e2']);
    // Repoints to null, NOT to the surviving sibling.
    expect(useWorkspaceToolStore.getState().activeEnvironmentId).toBeNull();
  });

  it('deleteEnvironment leaves a different active selection untouched', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e2', 'Prod'));
    useWorkspaceToolStore.getState().setActiveEnvironment('e2');
    useWorkspaceToolStore.getState().deleteEnvironment('e1');
    expect(useWorkspaceToolStore.getState().activeEnvironmentId).toBe('e2');
  });

  it('a v1 blob with NO environments key rehydrates environments to [] (no version bump)', () => {
    // Simulate a legacy persisted blob: version 1, no env keys.
    localStorage.setItem(
      'lingua-workspace-tool-state',
      JSON.stringify({
        state: {
          requests: [],
          responsesByRequestId: {},
          activeRequestId: null,
        },
        version: 1,
      })
    );
    // Force a rehydrate from the persisted blob.
    void useWorkspaceToolStore.persist.rehydrate();
    expect(useWorkspaceToolStore.getState().environments).toEqual([]);
    expect(useWorkspaceToolStore.getState().activeEnvironmentId).toBeNull();
  });

  it('rehydrate validates activeEnvironmentId against surviving environments', () => {
    localStorage.setItem(
      'lingua-workspace-tool-state',
      JSON.stringify({
        state: {
          requests: [],
          responsesByRequestId: {},
          activeRequestId: null,
          environments: [
            {
              version: 1,
              id: 'e1',
              name: 'Dev',
              variables: [{ key: 'host', value: 'x', secret: false }],
              createdAt: '2026-06-16T00:00:00.000Z',
              updatedAt: '2026-06-16T00:00:00.000Z',
            },
          ],
          // Points at a non-existent env → must rehydrate to null.
          activeEnvironmentId: 'gone',
        },
        version: 1,
      })
    );
    void useWorkspaceToolStore.persist.rehydrate();
    expect(
      useWorkspaceToolStore.getState().environments.map((e) => e.id)
    ).toEqual(['e1']);
    expect(useWorkspaceToolStore.getState().activeEnvironmentId).toBeNull();
  });

  it('updateEnvironmentVariables applies the updater to the CURRENT list (collapse-safe)', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    // Two adds dispatched back-to-back. A render-prop clobber would lose
    // the first; the functional updater composes them.
    useWorkspaceToolStore
      .getState()
      .updateEnvironmentVariables('e1', (vars) => [
        ...vars,
        { id: 'a', key: 'A', value: '1', secret: false },
      ]);
    useWorkspaceToolStore
      .getState()
      .updateEnvironmentVariables('e1', (vars) => [
        ...vars,
        { id: 'b', key: 'B', value: '2', secret: false },
      ]);
    const env = useWorkspaceToolStore.getState().environments[0];
    expect(env?.variables.map((v) => v.key)).toEqual(['A', 'B']);
    expect(env?.updatedAt).not.toBe('2026-06-16T00:00:00.000Z');
  });

  it('updateEnvironmentVariables is a no-op on an unknown id', () => {
    const before = useWorkspaceToolStore.getState();
    useWorkspaceToolStore
      .getState()
      .updateEnvironmentVariables('missing', () => [
        { id: 'x', key: 'X', value: '1', secret: false },
      ]);
    expect(useWorkspaceToolStore.getState()).toBe(before);
  });

  it('duplicateEnvironment clones with fresh row ids + preserved secrets, no auto-activate', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    useWorkspaceToolStore.getState().updateEnvironmentVariables('e1', () => [
      { id: 'orig-1', key: 'host', value: 'api.x', secret: false },
      { id: 'orig-2', key: 'token', value: 'sk-secret', secret: true },
    ]);
    useWorkspaceToolStore.getState().setActiveEnvironment('e1');

    useWorkspaceToolStore.getState().duplicateEnvironment('e1', 'e2', 'copy');
    const { environments, activeEnvironmentId } = useWorkspaceToolStore.getState();
    expect(environments.map((e) => e.id)).toEqual(['e1', 'e2']);
    const clone = environments[1]!;
    expect(clone.name).toBe('Dev copy');
    // Variable values + secret flags preserved.
    expect(clone.variables.map((v) => ({ key: v.key, value: v.value, secret: v.secret }))).toEqual([
      { key: 'host', value: 'api.x', secret: false },
      { key: 'token', value: 'sk-secret', secret: true },
    ]);
    // Row ids are FRESH (no collision with the source rows).
    expect(clone.variables[0]?.id).not.toBe('orig-1');
    expect(clone.variables[1]?.id).not.toBe('orig-2');
    // Does NOT auto-activate — the original stays active.
    expect(activeEnvironmentId).toBe('e1');
  });

  it('duplicateEnvironment is a no-op on an unknown id', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    useWorkspaceToolStore.getState().duplicateEnvironment('missing', 'e2', 'copy');
    expect(useWorkspaceToolStore.getState().environments).toHaveLength(1);
  });

  it('exportEnvironmentJson masks secret values + strips ids', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    useWorkspaceToolStore.getState().updateEnvironmentVariables('e1', () => [
      { id: 'r1', key: 'host', value: 'api.x', secret: false },
      { id: 'r2', key: 'token', value: 'sk-EXPORTSECRET', secret: true },
    ]);
    const json = useWorkspaceToolStore.getState().exportEnvironmentJson('e1')!;
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('Dev');
    expect(parsed.variables).toEqual([
      { key: 'host', value: 'api.x', secret: false },
      { key: 'token', value: '', secret: true },
    ]);
    // No resolved secret + no instance-local ids in the exported text.
    expect(json).not.toContain('sk-EXPORTSECRET');
    expect(json).not.toContain('e1');
    expect(json).not.toContain('r1');
    expect(json).not.toContain('r2');
  });

  it('exportEnvironmentJson returns null on an unknown id', () => {
    expect(useWorkspaceToolStore.getState().exportEnvironmentJson('missing')).toBeNull();
  });

  it('importEnvironmentJson mints a fresh id + appends without auto-activating', () => {
    useWorkspaceToolStore.getState().createEnvironment(makeEnv('e1', 'Dev'));
    useWorkspaceToolStore.getState().setActiveEnvironment('e1');
    const exportBlob = JSON.stringify({
      version: 1,
      name: 'Imported',
      variables: [
        { key: 'host', value: 'api.y', secret: false },
        { key: 'token', value: '', secret: true },
      ],
    });
    const result = useWorkspaceToolStore.getState().importEnvironmentJson(exportBlob);
    expect(result.ok).toBe(true);
    const { environments, activeEnvironmentId } = useWorkspaceToolStore.getState();
    expect(environments.map((e) => e.name)).toEqual(['Dev', 'Imported']);
    const imported = environments[1]!;
    // Fresh env id (not a hand-supplied one) + backfilled variable ids.
    expect(imported.id).toBeTruthy();
    expect(imported.id).not.toBe('e1');
    expect(imported.variables.every((v) => v.id.length > 0)).toBe(true);
    // Does NOT auto-activate.
    expect(activeEnvironmentId).toBe('e1');
  });

  it('importEnvironmentJson tolerates malformed JSON + invalid shapes', () => {
    expect(useWorkspaceToolStore.getState().importEnvironmentJson('not json {')).toEqual({
      ok: false,
    });
    expect(
      useWorkspaceToolStore.getState().importEnvironmentJson('{"version":2,"name":"x","variables":[]}')
    ).toEqual({ ok: false });
    expect(useWorkspaceToolStore.getState().importEnvironmentJson('[]')).toEqual({
      ok: false,
    });
    // None of the rejects appended anything.
    expect(useWorkspaceToolStore.getState().environments).toHaveLength(0);
  });

  it('rehydrate drops invalid environments but keeps valid ones', () => {
    localStorage.setItem(
      'lingua-workspace-tool-state',
      JSON.stringify({
        state: {
          requests: [],
          responsesByRequestId: {},
          activeRequestId: null,
          environments: [
            { version: 2, id: 'bad', name: 'x', variables: [] }, // wrong version → dropped
            {
              version: 1,
              id: 'e1',
              name: 'Dev',
              variables: [],
              createdAt: 'a',
              updatedAt: 'b',
            },
          ],
          activeEnvironmentId: 'e1',
        },
        version: 1,
      })
    );
    void useWorkspaceToolStore.persist.rehydrate();
    expect(
      useWorkspaceToolStore.getState().environments.map((e) => e.id)
    ).toEqual(['e1']);
    expect(useWorkspaceToolStore.getState().activeEnvironmentId).toBe('e1');
  });
});
