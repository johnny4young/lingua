import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachCrossTabSync } from '@/stores/persistence/crossTabSync';
import { migrationRegistry } from '@/stores/persistence/migrationRegistry';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useEnvVarsStore } from '@/stores/envVarsStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSnippetsStore } from '@/stores/snippetsStore';
import { useTrustEventStore } from '@/stores/trustEventStore';
import { useUtilityHistoryStore } from '@/stores/utilityHistoryStore';
import { resetWorkspaceSqlStoreForTests, useWorkspaceSqlStore } from '@/stores/workspaceSqlStore';
import { resetWorkspaceToolStoreForTests, useWorkspaceToolStore } from '@/stores/workspaceToolStore';
import { createBlankHttpRequest } from '../../../src/shared/httpWorkspaceSchema';
import { createBlankSqlQuery, type SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

// jsdom shares one window, so another tab's change is its write plus the event.
function otherTabStores(key: string, change: Record<string, unknown>, version?: number): void {
  const stored = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":1}') as {
    state: Record<string, unknown>;
    version: number;
  };
  localStorage.setItem(
    key,
    JSON.stringify({ state: { ...stored.state, ...change }, version: version ?? stored.version })
  );
  window.dispatchEvent(new StorageEvent('storage', { key }));
}

function otherTabRemoves(key: string): void {
  localStorage.removeItem(key);
  window.dispatchEvent(new StorageEvent('storage', { key }));
}

const stored = (key: string) =>
  JSON.parse(localStorage.getItem(key) as string).state as Record<string, unknown>;

function setProTier(): void {
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
          issuedTo: 'history@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

function sqlResponse(status: SqlResponseV1['status']): SqlResponseV1 {
  return {
    version: 1,
    status,
    rows: [],
    columns: [],
    rowCount: 0,
    durationMs: 1,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-05-26T00:00:00.000Z',
  };
}

describe('attachCrossTabSync', () => {
  function fakeStore(version = 2) {
    return {
      getState: () => ({ value: 'live' }),
      persist: {
        getOptions: () => ({
          name: 'probe',
          version,
          partialize: (state: { value: string }) => state,
          storage: { setItem: vi.fn() },
          merge: (persisted: unknown, live: { value: string }) => ({
            ...live,
            ...(persisted as object),
          }),
        }),
        setOptions: vi.fn(),
        rehydrate: vi.fn(),
      },
    };
  }

  beforeEach(() => localStorage.removeItem('probe'));

  it('keeps boot on the store merge until it is attached', () => {
    const store = fakeStore();

    expect(store.persist.setOptions).not.toHaveBeenCalled();
    attachCrossTabSync(store, { defaults: () => ({ value: 'default' }) });

    const { merge } = store.persist.setOptions.mock.calls[0]![0];
    expect(merge(undefined, { value: 'live' })).toEqual({ value: 'default' });
    expect(merge({ value: 'stored' }, { value: 'live' })).toEqual({ value: 'stored' });
  });

  it('applies keepLocal to a stored value and not to a removed key', () => {
    const store = fakeStore();
    attachCrossTabSync(store, {
      defaults: () => ({ value: 'default' }),
      keepLocal: (_next, live) => ({ value: live.value }),
    });

    const { merge } = store.persist.setOptions.mock.calls[0]![0];
    expect(merge({ value: 'stored' }, { value: 'live' })).toEqual({ value: 'live' });
    expect(merge(undefined, { value: 'live' })).toEqual({ value: 'default' });
  });

  it('rehydrates only for its own key, a removal, or a matching schema', () => {
    const store = fakeStore();
    attachCrossTabSync(store, { defaults: () => ({}) });

    localStorage.setItem('probe', JSON.stringify({ state: {}, version: 3 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'probe' }));
    expect(store.persist.rehydrate).not.toHaveBeenCalled();

    localStorage.setItem('probe', '{not json');
    window.dispatchEvent(new StorageEvent('storage', { key: 'probe' }));
    expect(store.persist.rehydrate).not.toHaveBeenCalled();

    localStorage.setItem('probe', JSON.stringify({ state: {}, version: 2 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'another' }));
    expect(store.persist.rehydrate).not.toHaveBeenCalled();

    window.dispatchEvent(new StorageEvent('storage', { key: 'probe' }));
    expect(store.persist.rehydrate).toHaveBeenCalledTimes(1);

    localStorage.removeItem('probe');
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(store.persist.rehydrate).toHaveBeenCalledTimes(2);
  });

  it('writes only what differs from the last value read or written', () => {
    const store = fakeStore();
    const options = store.persist.getOptions();
    store.persist.getOptions = () => options;
    attachCrossTabSync(store, { defaults: () => ({ value: 'default' }) });
    const { merge, storage } = store.persist.setOptions.mock.calls[0]![0];
    const write = (value: string) => storage.setItem('probe', { state: { value }, version: 2 });

    write('live');
    expect(options.storage.setItem).not.toHaveBeenCalled();

    write('changed');
    write('changed');
    expect(options.storage.setItem).toHaveBeenCalledTimes(1);

    merge({ value: 'stored' }, { value: 'changed' });
    write('stored');
    expect(options.storage.setItem).toHaveBeenCalledTimes(1);

    merge(undefined, { value: 'stored' });
    write('default');
    expect(options.storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('tells subscribers a change came from a rehydrate', () => {
    useSnippetsStore.setState({ snippets: [] });
    const seen: boolean[] = [];
    const unsubscribe = useSnippetsStore.subscribe(() => {
      seen.push(useSnippetsStore.persist.hasHydrated());
    });

    useSnippetsStore.getState().addSnippet({ label: 'here', description: '', language: 'javascript', code: '' });
    otherTabStores('lingua-snippets', { snippets: [] });
    unsubscribe();

    expect(seen).toEqual([true, false]);
    expect(useSnippetsStore.persist.hasHydrated()).toBe(true);
  });

  it('does nothing when storage is blocked and persist is absent', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');

    expect(() => attachCrossTabSync({}, { defaults: () => ({}) })).not.toThrow();
    expect(addEventListener).not.toHaveBeenCalled();
    addEventListener.mockRestore();
  });
});

describe('lingua-ai across tabs', () => {
  const KEY = 'lingua-ai';

  beforeEach(() => {
    localStorage.removeItem(KEY);
    useAiConfigStore.getState().clear();
    useAiConfigStore.getState().setEndpoint('https://models.example.com/v1/chat/completions');
    useAiConfigStore.getState().setModel('model-a');
    useAiConfigStore.getState().setApiKey('sk-live-secret');
  });

  it('drops the key when another tab clears it, and the next write does not restore it', () => {
    otherTabStores(KEY, { remoteApiKey: '' });

    expect(useAiConfigStore.getState().remoteApiKey).toBe('');
    // The send path reads the derived field.
    expect(useAiConfigStore.getState().apiKey).toBe('');

    useAiConfigStore.getState().setModel('model-b');
    expect(localStorage.getItem(KEY)).not.toContain('sk-live-secret');
  });

  it('resets to defaults without writing when the key is removed', () => {
    otherTabRemoves(KEY);

    const state = useAiConfigStore.getState();
    expect(state.remoteApiKey).toBe('');
    expect(state.apiKey).toBe('');
    expect(state.endpoint).toBe('');
    expect(state.model).toBe('');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('ignores another schema version without writing back', () => {
    const version = useAiConfigStore.persist.getOptions().version as number;
    otherTabStores(KEY, { remoteApiKey: '' }, version + 1);

    expect(useAiConfigStore.getState().remoteApiKey).toBe('sk-live-secret');
    expect(JSON.parse(localStorage.getItem(KEY) as string).version).toBe(version + 1);
  });
});

describe('lingua-snippets across tabs', () => {
  const KEY = 'lingua-snippets';

  beforeEach(() => {
    localStorage.removeItem(KEY);
    useSnippetsStore.setState({ snippets: [], pendingLinkedSnippetId: null });
    useSnippetsStore.getState().addSnippet({ label: 'one', description: '', language: 'javascript', code: '' });
  });

  it('keeps a snippet another tab added through a write here', () => {
    const [mine] = useSnippetsStore.getState().snippets;
    const theirs = { ...mine!, id: 'theirs', label: 'theirs' };
    otherTabStores(KEY, { snippets: [mine, theirs] });

    useSnippetsStore.getState().addSnippet({ label: 'two', description: '', language: 'javascript', code: '' });

    expect((stored(KEY).snippets as { label: string }[]).map((s) => s.label)).toEqual([
      'one',
      'theirs',
      'two',
    ]);
  });

  it('does not restore a removed key, and keeps state that is not persisted', () => {
    useSnippetsStore.setState({ pendingLinkedSnippetId: 'pending' });

    otherTabRemoves(KEY);
    expect(useSnippetsStore.getState().snippets).toEqual([]);
    expect(useSnippetsStore.getState().pendingLinkedSnippetId).toBe('pending');
    expect(localStorage.getItem(KEY)).toBeNull();

    useSnippetsStore.getState().addSnippet({ label: 'new', description: '', language: 'javascript', code: '' });
    expect((stored(KEY).snippets as { label: string }[]).map((s) => s.label)).toEqual(['new']);
  });
});

describe('lingua-trust-events across tabs', () => {
  const KEY = 'lingua-trust-events';
  const record = (action: string) =>
    useTrustEventStore
      .getState()
      .record({ feature: 'license', action, sensitivity: 'low', summary: action });

  beforeEach(() => {
    localStorage.removeItem(KEY);
    useTrustEventStore.setState({ events: [] });
    record('first');
  });

  it('does not restore a log another tab cleared', () => {
    otherTabStores(KEY, { events: [] });
    record('second');

    expect((stored(KEY).events as { action: string }[]).map((e) => e.action)).toEqual(['second']);
  });

  it('empties the log without writing when the key is removed', () => {
    otherTabRemoves(KEY);

    expect(useTrustEventStore.getState().events).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('lingua-env-vars across tabs', () => {
  const KEY = 'lingua-env-vars';

  beforeEach(() => {
    localStorage.removeItem(KEY);
    useEnvVarsStore.setState({ global: {}, project: {}, tab: {} });
    useEnvVarsStore.getState().setGlobalVar('API_TOKEN', 'secret-value');
  });

  it('does not restore a variable another tab deleted', () => {
    otherTabStores(KEY, { global: {} });
    useEnvVarsStore.getState().setGlobalVar('REGION', 'eu');

    expect(stored(KEY).global).toEqual({ REGION: 'eu' });
  });

  it('empties every tier without writing when the key is removed', () => {
    otherTabRemoves(KEY);

    expect(useEnvVarsStore.getState().global).toEqual({});
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('lingua-utility-state across tabs', () => {
  const KEY = 'lingua-utility-state';
  const entry = (input: string) => ({ id: input, at: '2026-01-01T00:00:00.000Z', input, output: input, truncated: false });

  beforeEach(() => {
    setProTier();
    useUtilityHistoryStore.setState({
      history: { 'json-formatter': [entry('saved')], 'jwt-decoder': [entry('session-only')] },
      persistEnabled: { 'json-formatter': true },
      favorites: [],
    });
  });

  it('keeps session-only history when another tab pins a favorite', () => {
    otherTabStores(KEY, { favorites: ['base64'] });

    const state = useUtilityHistoryStore.getState();
    expect(state.favorites).toEqual(['base64']);
    expect(state.history['jwt-decoder']).toEqual([entry('session-only')]);
    expect(state.history['json-formatter']).toEqual([entry('saved')]);
  });

  it('never writes session-only history to storage after applying a change', () => {
    otherTabStores(KEY, { favorites: ['base64'] });
    useUtilityHistoryStore.getState().pinFavorite('json-formatter');

    expect(localStorage.getItem(KEY)).not.toContain('session-only');
  });

  it('does not restore history another tab cleared for a saved tool', () => {
    otherTabStores(KEY, { history: {} });

    expect(useUtilityHistoryStore.getState().history['json-formatter']).toBeUndefined();
    useUtilityHistoryStore.getState().pinFavorite('base64');
    expect(localStorage.getItem(KEY)).not.toContain('saved');
  });

  it('stops saving a tool when another tab turns persistence off', () => {
    otherTabStores(KEY, { persistEnabled: {}, history: {} });

    useUtilityHistoryStore.getState().pinFavorite('base64');
    expect(localStorage.getItem(KEY)).not.toContain('saved');
    // It stays in memory for this tab, as it does in the tab that turned it off.
    expect(useUtilityHistoryStore.getState().history['json-formatter']).toEqual([entry('saved')]);
  });

  it('wipes session-only history too when the key is removed', () => {
    otherTabRemoves(KEY);

    const state = useUtilityHistoryStore.getState();
    expect(state.history).toEqual({});
    expect(state.persistEnabled).toEqual({});
    expect(state.favorites).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('lingua-workspace-sql-state across tabs', () => {
  const KEY = 'lingua-workspace-sql-state';
  const query = (id: string) => createBlankSqlQuery({ id, name: id });

  beforeEach(() => {
    resetWorkspaceSqlStoreForTests();
    const store = useWorkspaceSqlStore.getState();
    store.createQuery(query('a'));
    store.createQuery(query('b'));
    store.createQuery(query('c'));
    // This tab shows c and a; another tab's view of the same queries differs.
    useWorkspaceSqlStore.setState({ openQueryIds: ['c', 'a'], activeQueryId: 'a', explorerFolded: true });
  });

  it('keeps this tab open queries and active query when another tab writes', () => {
    otherTabStores(KEY, { openQueryIds: ['b'], activeQueryId: 'b', explorerFolded: false });

    const state = useWorkspaceSqlStore.getState();
    expect(state.openQueryIds).toEqual(['c', 'a']);
    expect(state.activeQueryId).toBe('a');
    expect(state.explorerFolded).toBe(true);
  });

  it('closes a query another tab deleted and moves to one still open', () => {
    const queries = (stored(KEY).queries as { id: string }[]).filter((q) => q.id !== 'a');
    otherTabStores(KEY, { queries });

    const state = useWorkspaceSqlStore.getState();
    expect(state.queries.map((q) => q.id)).toEqual(['c', 'b']);
    expect(state.openQueryIds).toEqual(['c']);
    expect(state.activeQueryId).toBe('c');
  });

  it('keeps a timeout on screen and out of storage', () => {
    useWorkspaceSqlStore.getState().recordResponse('a', sqlResponse('timeout'));
    otherTabStores(KEY, { history: [] });

    expect(useWorkspaceSqlStore.getState().getLatestResponse('a')?.status).toBe('timeout');
    expect(stored(KEY).responsesByQueryId).toEqual({});
  });

  it('applies stored result rows from another tab', () => {
    otherTabStores(KEY, { responsesByQueryId: { b: [sqlResponse('success')] } });

    expect(useWorkspaceSqlStore.getState().getLatestResponse('b')?.status).toBe('success');
  });

  it('leaves the stored value alone when the engine loads and changes nothing stored', () => {
    const store = useWorkspaceSqlStore.getState();
    otherTabStores(KEY, { openQueryIds: ['b'], activeQueryId: 'b' });
    const raw = localStorage.getItem(KEY);

    store.setStorageMode('opfs', 'opfs');
    store.setStorageMode('opfs', 'opfs');
    store.pruneTableSources([]);

    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(useWorkspaceSqlStore.getState().storageMode).toBe('opfs');
  });

  it('stores this tab fields again on its next real change', () => {
    otherTabStores(KEY, { openQueryIds: ['b'], activeQueryId: 'b' });

    useWorkspaceSqlStore.getState().toggleExplorerFolded();

    expect(stored(KEY)).toMatchObject({
      openQueryIds: ['c', 'a'],
      activeQueryId: 'a',
      explorerFolded: false,
    });
  });

  it('does not bring back a removed key until something changes', () => {
    otherTabRemoves(KEY);

    useWorkspaceSqlStore.getState().setStorageMode('opfs', 'opfs');
    useWorkspaceSqlStore.getState().pruneTableSources([]);
    expect(localStorage.getItem(KEY)).toBeNull();

    useWorkspaceSqlStore.getState().toggleExplorerFolded();
    expect(stored(KEY).explorerFolded).toBe(true);
  });

  it('retries a value whose write failed', () => {
    const failure = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => useWorkspaceSqlStore.getState().toggleExplorerFolded()).toThrow('full');
    failure.mockRestore();

    useWorkspaceSqlStore.getState().pruneTableSources([]);

    expect(stored(KEY).explorerFolded).toBe(false);
  });

  it('resets stored data and keeps the engine backing when the key is removed', () => {
    useWorkspaceSqlStore.getState().setStorageMode('opfs', 'opfs');
    localStorage.removeItem(KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    const state = useWorkspaceSqlStore.getState();
    expect(state.queries).toEqual([]);
    expect(state.openQueryIds).toEqual([]);
    expect(state.activeQueryId).toBeNull();
    expect(state.storageMode).toBe('opfs');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('lingua-workspace-tool-state across tabs', () => {
  const KEY = 'lingua-workspace-tool-state';

  beforeEach(() => {
    resetWorkspaceToolStoreForTests();
    const store = useWorkspaceToolStore.getState();
    store.createRequest(createBlankHttpRequest({ id: 'one' }));
    store.createRequest(createBlankHttpRequest({ id: 'two' }));
    useWorkspaceToolStore.setState({ activeRequestId: 'one' });
  });

  it('keeps the active request and a request in flight when another tab writes', () => {
    useWorkspaceToolStore.getState().setExecutingRequestId('one');

    otherTabStores(KEY, { activeRequestId: 'two' });

    const state = useWorkspaceToolStore.getState();
    expect(state.activeRequestId).toBe('one');
    expect(state.executingRequestId).toBe('one');
  });

  it('does not store its active request when a run starts', () => {
    otherTabStores(KEY, { activeRequestId: 'two' });
    const raw = localStorage.getItem(KEY);

    useWorkspaceToolStore.getState().setExecutingRequestId('one');

    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it('keeps a network failure on screen and out of storage', () => {
    useWorkspaceToolStore.getState().recordResponse('one', {
      version: 1,
      kind: 'network-error',
      status: 0,
      statusText: '',
      url: 'https://example.com/',
      finalUrl: 'https://example.com/',
      headers: [],
      body: '',
      contentType: '',
      sizeBytes: 0,
      durationMs: 1,
      tooLarge: false,
      redactedHeaders: [],
      recordedAt: '2026-05-26T00:00:00.000Z',
    });

    otherTabStores(KEY, { activeRequestId: 'two' });

    expect(useWorkspaceToolStore.getState().getLatestResponse('one')?.kind).toBe('network-error');
    expect(stored(KEY).responsesByRequestId).toEqual({});
  });

  it('drops a request another tab deleted and does not restore it', () => {
    const requests = (stored(KEY).requests as { id: string }[]).filter((r) => r.id !== 'one');
    otherTabStores(KEY, { requests });

    expect(useWorkspaceToolStore.getState().activeRequestId).toBeNull();
    useWorkspaceToolStore.getState().setActiveRequest('two');
    expect((stored(KEY).requests as { id: string }[]).map((r) => r.id)).toEqual(['two']);
  });

  it('resets everything without writing when the key is removed', () => {
    otherTabRemoves(KEY);

    const state = useWorkspaceToolStore.getState();
    expect(state.requests).toEqual([]);
    expect(state.activeRequestId).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

// Adding a persisted store fails here until someone decides which list it joins.
describe('every persisted store has a cross-tab decision', () => {
  const SYNCED: Record<string, string> = {
    'lingua-settings': 'settingsStore.ts',
    'lingua-ai': 'aiConfigStore.ts',
    'lingua-snippets': 'snippetsStore.ts',
    'lingua-trust-events': 'trustEventStore.ts',
    'lingua-env-vars': 'envVarsStore.ts',
    'lingua-utility-state': 'utilityHistoryStore.ts',
    'lingua-workspace-sql-state': 'workspaceSqlStore.ts',
    'lingua-workspace-tool-state': 'workspaceToolStore.ts',
  };
  const NOT_SYNCED: Record<string, [file: string, reason: string]> = {
    'lingua-license': ['licenseWebStore.ts', 'has its own listener, which revalidates with the server'],
    'lingua-session': ['sessionStore.ts', 'each tab snapshots its own editor tabs'],
    'lingua-notebook-state': ['notebookStore.ts', 'keyed by editor tab, holds live working cells'],
    'lingua-utility-workspace': ['utilityWorkspaceStore.ts', 'the tool selected in this tab'],
    'lingua-utility-pipeline-state': ['utilityPipelineStore.ts', 'recipes only, nothing sensitive or clearable'],
    'lingua-project-store': ['projectStore.ts', 'a recent list, nothing sensitive'],
    'lingua-recent-files': ['recentFilesStore.ts', 'a recent list, nothing sensitive'],
    'lingua-debugger-state': ['debuggerStore.ts', 'breakpoints, nothing sensitive'],
    'lingua-lesson-progress': ['lessonProgressStore.ts', 'progress marks, nothing sensitive'],
  };
  const source = (file: string) =>
    readFileSync(resolve(__dirname, '../../../src/renderer/stores', file), 'utf-8');

  it('lists every registered store exactly once', () => {
    expect([...Object.keys(SYNCED), ...Object.keys(NOT_SYNCED)].sort()).toEqual(
      Object.keys(migrationRegistry).sort()
    );
  });

  it.each(Object.entries(SYNCED))('%s attaches the sync', (_name, file) => {
    expect(source(file)).toMatch(/attachCrossTabSync\(use\w+Store,/);
  });

  it.each(Object.entries(NOT_SYNCED))('%s does not', (_name, [file]) => {
    expect(source(file)).not.toContain('attachCrossTabSync');
  });
});
