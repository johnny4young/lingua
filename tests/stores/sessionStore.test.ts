import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  armPendingSessionRestoreSnapshot,
  clearPendingSessionRestoreSnapshot,
  getPendingSessionRestoreTabCount,
  sessionSnapshotEqual,
  useSessionStore,
} from '@/stores/sessionStore';
import {
  useEditorStore,
  SQL_WORKSPACE_TAB_ID,
  HTTP_WORKSPACE_TAB_ID,
  UTILITIES_WORKSPACE_TAB_ID,
} from '@/stores/editorStore';
import { resetRecipeStoreForTests, useRecipeStore } from '@/stores/recipeStore';
import { useUIStore } from '@/stores/uiStore';
import { resetWorkspaceSqlStoreForTests, useWorkspaceSqlStore } from '@/stores/workspaceSqlStore';
import {
  resetWorkspaceToolStoreForTests,
  useWorkspaceToolStore,
} from '@/stores/workspaceToolStore';
import { createBlankSqlQuery } from '#src/shared/sqlWorkspace';
import { createBlankHttpRequest } from '#src/shared/httpWorkspace';

describe('sessionStore', () => {
  const initialSessionState = useSessionStore.getState();
  const initialEditorState = useEditorStore.getState();

  beforeEach(() => {
    useSessionStore.setState(initialSessionState, true);
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useUIStore.setState({ activeBottomPanel: 'console', consoleVisible: false });
    resetRecipeStoreForTests();
    resetWorkspaceSqlStoreForTests();
    resetWorkspaceToolStoreForTests();
    clearPendingSessionRestoreSnapshot();
    localStorage.clear();

    Object.defineProperty(globalThis, 'window', {
      value: {
        lingua: {
          fs: {
            read: vi.fn().mockResolvedValue('restored content'),
            reopenFile: vi.fn().mockResolvedValue({
              ok: true,
              rootId: 'root-restored',
              rootPath: '/path',
              fileRelativePath: 'hello.js',
            }),
            reopenRoot: vi.fn(),
            revokeRoot: vi.fn().mockResolvedValue(true),
          },
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    useSessionStore.setState(initialSessionState, true);
    useEditorStore.setState(initialEditorState, true);
    resetRecipeStoreForTests();
    clearPendingSessionRestoreSnapshot();
    localStorage.clear();
  });

  it('should start with empty saved tabs', () => {
    const { savedTabs } = useSessionStore.getState();
    expect(savedTabs).toHaveLength(0);
  });

  it('should save the current editor session', () => {
    // Set up editor with tabs
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-1',
          name: 'hello.js',
          language: 'javascript',
          content: 'console.log("hi")',
          isDirty: false,
          filePath: '/path/hello.js',
          recipeBindingId: 'js-sort-objects',
          stdinBuffer: 'Ada',
          inputArgs: ['--mode', 'fast'],
          inputSets: [
            {
              id: 'set-happy',
              name: 'Happy path',
              stdin: 'Ada',
              args: ['--mode', 'fast'],
            },
          ],
          activeInputSetId: 'set-happy',
        },
        {
          id: 'tab-2',
          name: 'untitled.ts',
          language: 'typescript',
          content: 'const x = 42;',
          isDirty: true,
        },
      ],
      activeTabId: 'tab-1',
    });

    useSessionStore.getState().saveSession();

    const { savedTabs, savedActiveIndex } = useSessionStore.getState();
    expect(savedTabs).toHaveLength(2);
    expect(savedActiveIndex).toBe(0);

    // Disk-backed tab stores empty content (re-reads on restore)
    expect(savedTabs[0].content).toBe('');
    expect(savedTabs[0].filePath).toBe('/path/hello.js');
    expect(savedTabs[0].recipeBindingId).toBe('js-sort-objects');
    expect(savedTabs[0].inputSets).toEqual([
      {
        id: 'set-happy',
        name: 'Happy path',
        stdin: 'Ada',
        args: ['--mode', 'fast'],
      },
    ]);
    expect(savedTabs[0].activeInputSetId).toBe('set-happy');
    expect(savedTabs[0].inputArgs).toEqual(['--mode', 'fast']);

    // In-memory tab stores content
    expect(savedTabs[1].content).toBe('const x = 42;');
    expect(savedTabs[1].filePath).toBeUndefined();
  });

  it('should restore tabs from saved session', async () => {
    // Pre-populate saved session
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'restored.js',
          language: 'javascript',
          content: '',
          filePath: '/path/restored.js',
        },
        {
          name: 'scratch.py',
          language: 'python',
          content: 'print("hello")',
          stdinBuffer: 'Ada',
          inputArgs: ['--count', '2'],
          inputSets: [
            {
              id: 'set-python',
              name: 'Two runs',
              stdin: 'Ada',
              args: ['--count', '2'],
            },
          ],
          activeInputSetId: 'set-python',
        },
      ],
      savedActiveIndex: 1,
    });

    await useSessionStore.getState().restoreSession();

    const { tabs, activeTabId } = useEditorStore.getState();
    expect(tabs).toHaveLength(2);

    // Disk-backed tab should have been read from disk
    expect(tabs[0].name).toBe('restored.js');
    expect(tabs[0].content).toBe('restored content');
    expect(tabs[0].filePath).toBe('/path/restored.js');

    // In-memory tab uses saved content
    expect(tabs[1].name).toBe('scratch.py');
    expect(tabs[1].content).toBe('print("hello")');
    expect(tabs[1].stdinBuffer).toBe('Ada');
    expect(tabs[1].inputSets).toEqual([
      {
        id: 'set-python',
        name: 'Two runs',
        stdin: 'Ada',
        args: ['--count', '2'],
      },
    ]);
    expect(tabs[1].activeInputSetId).toBe('set-python');
    expect(tabs[1].inputArgs).toEqual(['--count', '2']);

    // Active tab should be the second one (index 1)
    expect(activeTabId).toBe(tabs[1].id);
  });

  it('sanitizes malformed and oversized input-set state during restore', async () => {
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'scratch.js',
          language: 'javascript',
          content: 'console.log(1)',
          inputSets: [
            {
              id: 'set-valid',
              name: '  Valid set  ',
              stdin: 'Ada',
              args: ['--mode', 42, 'fast'] as unknown as string[],
            },
            { id: 'set-broken', name: '', stdin: 'ignored' },
            { id: 'set-valid', name: 'Duplicate id', stdin: 'ignored' },
          ],
          activeInputSetId: 'missing-set',
          inputArgs: [...Array.from({ length: 70 }, (_, index) => `arg-${index}`), 42] as unknown as string[],
        },
      ],
      savedActiveIndex: 0,
    });

    await useSessionStore.getState().restoreSession();

    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.inputSets).toEqual([
      { id: 'set-valid', name: 'Valid set', stdin: 'Ada', args: ['--mode', 'fast'] },
    ]);
    expect(tab?.activeInputSetId).toBeUndefined();
    expect(tab?.inputArgs).toHaveLength(64);
    expect(tab?.inputArgs?.[63]).toBe('arg-63');
  });

  it('restores the armed ask-mode snapshot even if autosave replaces savedTabs before restore', async () => {
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'previous.js',
          language: 'javascript',
          content: 'console.log("previous")',
        },
      ],
      savedActiveIndex: 0,
    });
    expect(armPendingSessionRestoreSnapshot()).toBe(1);

    useSessionStore.setState({
      savedTabs: [
        {
          name: 'new-work.js',
          language: 'javascript',
          content: 'console.log("new work")',
        },
      ],
      savedActiveIndex: 0,
    });

    await useSessionStore.getState().restoreSession();

    const { tabs, activeTabId } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.name).toBe('previous.js');
    expect(tabs[0]?.content).toBe('console.log("previous")');
    expect(activeTabId).toBe(tabs[0]?.id);
    expect(getPendingSessionRestoreTabCount()).toBe(0);
  });

  it('restores recipe bindings into the editor tab and transient recipe store', async () => {
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'js-sort-objects.js',
          language: 'javascript',
          content: 'const sorted = [];',
          recipeBindingId: 'js-sort-objects',
        },
      ],
      savedActiveIndex: 0,
    });

    await useSessionStore.getState().restoreSession();

    const { tabs } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].recipeBindingId).toBe('js-sort-objects');
    expect(useRecipeStore.getState().getBindingForTab(tabs[0].id)).toBe('js-sort-objects');
  });

  it('restores the Recipe panel when the active restored tab has a recipe binding', async () => {
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'js-sort-objects.js',
          language: 'javascript',
          content: 'const sorted = [];',
          recipeBindingId: 'js-sort-objects',
        },
        {
          name: 'scratch.py',
          language: 'python',
          content: 'print("hello")',
        },
      ],
      savedActiveIndex: 0,
    });

    await useSessionStore.getState().restoreSession();

    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'recipe',
      consoleVisible: true,
    });
  });

  it('should handle missing files gracefully during restore', async () => {
    (window.lingua.fs.read as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

    useSessionStore.setState({
      savedTabs: [
        {
          name: 'gone.rs',
          language: 'rust',
          content: '',
          filePath: '/deleted/gone.rs',
        },
      ],
      savedActiveIndex: 0,
    });

    await useSessionStore.getState().restoreSession();

    const { tabs } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].content).toContain('File not found');
  });

  it('restores unknown file extensions as plaintext tabs', async () => {
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'notes.txt',
          language: 'javascript',
          content: '',
          filePath: '/docs/notes.txt',
        },
      ],
      savedActiveIndex: 0,
    });

    await useSessionStore.getState().restoreSession();

    const { tabs } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].name).toBe('notes.txt');
    expect(tabs[0].language).toBe('plaintext');
  });

  it('should not restore when there are no saved tabs', async () => {
    await useSessionStore.getState().restoreSession();
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  // SQL/HTTP MODEL rework — SQL and HTTP are COLLECTION workspaces: at
  // most ONE SQL tab and ONE HTTP tab, each carrying a stable constant
  // id. The collection of queries/requests rehydrates from its own
  // localStorage store, independent of the session tab — so the session
  // only needs to re-create the single container tab on the stable id.
  // A pre-rework session that encoded N per-query tabs must collapse to
  // the single workspace tab per kind WITHOUT orphaning the persisted
  // collection (it rehydrates from its own store regardless).
  describe('SQL / HTTP / Utilities workspace tab restore', () => {
    it('saves a sql workspace tab on the stable workspace id', () => {
      useEditorStore.setState({
        tabs: [
          {
            id: SQL_WORKSPACE_TAB_ID,
            name: 'SQL',
            language: 'sql',
            content: '',
            isDirty: false,
            kind: 'sql',
          },
        ],
        activeTabId: SQL_WORKSPACE_TAB_ID,
      });

      useSessionStore.getState().saveSession();

      const { savedTabs } = useSessionStore.getState();
      expect(savedTabs).toHaveLength(1);
      expect(savedTabs[0].kind).toBe('sql');
      // The persisted id is the stable workspace id, not a per-query id.
      expect(savedTabs[0].workspaceTabId).toBe(SQL_WORKSPACE_TAB_ID);
      expect(savedTabs[0].notebookTabId).toBeUndefined();
    });

    it('restores a sql workspace tab on the stable id; the collection rehydrates from its own store', async () => {
      // The collection lives in `useWorkspaceSqlStore`, rehydrated from
      // its own localStorage key — NOT keyed by the tab id. Seeding a
      // query here mirrors what the rail wrote during the prior session.
      useWorkspaceSqlStore.getState().createQuery(
        createBlankSqlQuery({
          id: 'query-uuid-1',
          name: 'Top customers',
          query: 'SELECT * FROM customers;',
        })
      );

      useSessionStore.setState({
        savedTabs: [
          {
            name: 'SQL',
            language: 'sql',
            content: '',
            kind: 'sql',
            workspaceTabId: SQL_WORKSPACE_TAB_ID,
          },
        ],
        savedActiveIndex: 0,
      });

      await useSessionStore.getState().restoreSession();

      const { tabs, activeTabId } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].kind).toBe('sql');
      // The single SQL workspace tab restores on the stable id.
      expect(tabs[0].id).toBe(SQL_WORKSPACE_TAB_ID);
      expect(activeTabId).toBe(SQL_WORKSPACE_TAB_ID);
      // The collection is intact — the query is still resolvable by its
      // own id, untouched by the tab restore.
      const restoredQuery = useWorkspaceSqlStore.getState().getQuery('query-uuid-1');
      expect(restoredQuery?.query).toBe('SELECT * FROM customers;');
    });

    it('round-trips a sql workspace tab through save then restore on the stable id', async () => {
      useWorkspaceSqlStore.getState().createQuery(
        createBlankSqlQuery({
          id: 'query-uuid-2',
          name: 'Revenue',
          query: 'SELECT sum(total) FROM orders;',
        })
      );
      useEditorStore.setState({
        tabs: [
          {
            id: SQL_WORKSPACE_TAB_ID,
            name: 'SQL',
            language: 'sql',
            content: '',
            isDirty: false,
            kind: 'sql',
          },
        ],
        activeTabId: SQL_WORKSPACE_TAB_ID,
      });

      // Save, then wipe the editor (simulating a reload) and restore.
      useSessionStore.getState().saveSession();
      useEditorStore.setState({ tabs: [], activeTabId: null });
      await useSessionStore.getState().restoreSession();

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe(SQL_WORKSPACE_TAB_ID);
      // The collection survived independently.
      expect(useWorkspaceSqlStore.getState().getQuery('query-uuid-2')?.query).toBe(
        'SELECT sum(total) FROM orders;'
      );
    });

    it('restores an http workspace tab on the stable id; the collection rehydrates from its own store', async () => {
      const blank = createBlankHttpRequest({
        id: 'request-uuid-1',
        name: 'Fetch user',
      });
      useWorkspaceToolStore.getState().createRequest({
        ...blank,
        method: 'POST',
        url: 'https://api.example.com/users',
      });

      useSessionStore.setState({
        savedTabs: [
          {
            name: 'HTTP',
            language: 'http',
            content: '',
            kind: 'http',
            workspaceTabId: HTTP_WORKSPACE_TAB_ID,
          },
        ],
        savedActiveIndex: 0,
      });

      await useSessionStore.getState().restoreSession();

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].kind).toBe('http');
      expect(tabs[0].id).toBe(HTTP_WORKSPACE_TAB_ID);
      const restoredRequest = useWorkspaceToolStore.getState().getRequest('request-uuid-1');
      expect(restoredRequest?.url).toBe('https://api.example.com/users');
      expect(restoredRequest?.method).toBe('POST');
    });

    it('saves and restores the utilities workspace tab on the stable id', async () => {
      useEditorStore.setState({
        tabs: [
          {
            id: UTILITIES_WORKSPACE_TAB_ID,
            name: 'Utilities',
            language: 'utilities',
            content: '',
            isDirty: false,
            kind: 'utilities',
          },
        ],
        activeTabId: UTILITIES_WORKSPACE_TAB_ID,
      });

      useSessionStore.getState().saveSession();

      const { savedTabs } = useSessionStore.getState();
      expect(savedTabs).toHaveLength(1);
      expect(savedTabs[0].kind).toBe('utilities');
      expect(savedTabs[0].workspaceTabId).toBe(UTILITIES_WORKSPACE_TAB_ID);

      useEditorStore.setState({ tabs: [], activeTabId: null });
      await useSessionStore.getState().restoreSession();

      const { tabs, activeTabId } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toMatchObject({
        id: UTILITIES_WORKSPACE_TAB_ID,
        name: 'Utilities',
        language: 'utilities',
        kind: 'utilities',
      });
      expect(activeTabId).toBe(UTILITIES_WORKSPACE_TAB_ID);
    });

    it('MIGRATION: a legacy per-query session collapses to one sql + one http workspace tab without orphaning the collection', async () => {
      // Pre-rework, each query/request had its OWN `kind: 'sql'` /
      // `kind: 'http'` FileTab keyed by the query/request id. The
      // collection was likewise keyed by those ids. Seed three queries
      // and two requests with the legacy per-entry ids.
      for (const [id, query] of [
        ['legacy-sql-1', 'SELECT 1;'],
        ['legacy-sql-2', 'SELECT 2;'],
        ['legacy-sql-3', 'SELECT 3;'],
      ] as const) {
        useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id, name: id, query }));
      }
      for (const [id, url] of [
        ['legacy-http-1', 'https://a.dev'],
        ['legacy-http-2', 'https://b.dev'],
      ] as const) {
        const blank = createBlankHttpRequest({ id, name: id });
        useWorkspaceToolStore.getState().createRequest({ ...blank, url });
      }

      // A legacy session: one FileTab per query/request, ids = entry ids.
      useSessionStore.setState({
        savedTabs: [
          { name: 'q1', language: 'sql', content: '', kind: 'sql', workspaceTabId: 'legacy-sql-1' },
          { name: 'q2', language: 'sql', content: '', kind: 'sql', workspaceTabId: 'legacy-sql-2' },
          { name: 'q3', language: 'sql', content: '', kind: 'sql', workspaceTabId: 'legacy-sql-3' },
          {
            name: 'r1',
            language: 'http',
            content: '',
            kind: 'http',
            workspaceTabId: 'legacy-http-1',
          },
          {
            name: 'r2',
            language: 'http',
            content: '',
            kind: 'http',
            workspaceTabId: 'legacy-http-2',
          },
        ],
        // The active tab was the second SQL query — it must remap onto
        // the single surviving SQL workspace tab.
        savedActiveIndex: 1,
      });

      await useSessionStore.getState().restoreSession();

      const { tabs, activeTabId } = useEditorStore.getState();
      // Collapsed: exactly one SQL tab + one HTTP tab, on the stable ids.
      const sqlTabs = tabs.filter(t => t.kind === 'sql');
      const httpTabs = tabs.filter(t => t.kind === 'http');
      expect(sqlTabs).toHaveLength(1);
      expect(httpTabs).toHaveLength(1);
      expect(sqlTabs[0]!.id).toBe(SQL_WORKSPACE_TAB_ID);
      expect(httpTabs[0]!.id).toBe(HTTP_WORKSPACE_TAB_ID);
      expect(tabs).toHaveLength(2);
      // The active index (a legacy SQL duplicate) remaps onto the single
      // surviving SQL workspace tab — never an orphan id.
      expect(activeTabId).toBe(SQL_WORKSPACE_TAB_ID);

      // CRITICAL: the collection is NOT orphaned — every legacy query +
      // request still resolves by its own id, so no user work is lost.
      const sql = useWorkspaceSqlStore.getState();
      expect(sql.queries).toHaveLength(3);
      expect(sql.getQuery('legacy-sql-1')?.query).toBe('SELECT 1;');
      expect(sql.getQuery('legacy-sql-2')?.query).toBe('SELECT 2;');
      expect(sql.getQuery('legacy-sql-3')?.query).toBe('SELECT 3;');
      const tool = useWorkspaceToolStore.getState();
      expect(tool.requests).toHaveLength(2);
      expect(tool.getRequest('legacy-http-1')?.url).toBe('https://a.dev');
      expect(tool.getRequest('legacy-http-2')?.url).toBe('https://b.dev');
    });

    it('falls back to a plain tab when a sql kind is missing workspaceTabId', async () => {
      // Corrupt session entry: `kind: 'sql'` but no `workspaceTabId`.
      // The restore drops the discriminator rather than minting a
      // workspace tab from a half-written entry.
      useSessionStore.setState({
        savedTabs: [
          {
            name: 'Orphaned query',
            language: 'sql',
            content: '',
            kind: 'sql',
          },
        ],
        savedActiveIndex: 0,
      });

      await useSessionStore.getState().restoreSession();

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].kind).toBeUndefined();
    });
  });

  describe('sessionSnapshotEqual', () => {
    const baseTab = (overrides: Record<string, unknown> = {}) => ({
      id: 'tab-1',
      name: 'untitled.ts',
      language: 'typescript' as const,
      content: 'const x = 1;',
      isDirty: false,
      ...overrides,
    });

    const snapshot = (
      tabs: ReturnType<typeof baseTab>[],
      activeTabId: string | null = 'tab-1'
    ) => ({ tabs, activeTabId }) as Parameters<typeof sessionSnapshotEqual>[0];

    it('treats transient-only mutations as equal (the §3.10 noise)', () => {
      const a = snapshot([baseTab()]);
      const b = snapshot([
        baseTab({ isDirty: true, executionState: 'running', parseError: 'boom' }),
      ]);
      expect(sessionSnapshotEqual(a, b)).toBe(true);
    });

    it('short-circuits on referential equality of the tabs array', () => {
      const tabs = [baseTab()];
      expect(sessionSnapshotEqual(snapshot(tabs), snapshot(tabs))).toBe(true);
    });

    it('ignores content edits on disk-backed tabs (serialized as empty either way)', () => {
      const a = snapshot([baseTab({ filePath: '/p/a.ts', content: 'v1' })]);
      const b = snapshot([baseTab({ filePath: '/p/a.ts', content: 'v2 edited' })]);
      expect(sessionSnapshotEqual(a, b)).toBe(true);
    });

    it.each([
      ['id', { id: 'tab-other' }],
      ['name', { name: 'renamed.ts' }],
      ['language', { language: 'javascript' }],
      ['content (untitled tab)', { content: 'const x = 2;' }],
      ['filePath', { filePath: '/p/a.ts' }],
      ['runtimeMode', { runtimeMode: 'node' }],
      ['stdinBuffer', { stdinBuffer: 'line1\n' }],
      ['inputSets', { inputSets: [{ id: 'set-1', name: 'Happy', stdin: 'line1' }] }],
      ['activeInputSetId', { activeInputSetId: 'set-1' }],
      ['inputArgs', { inputArgs: ['--fast'] }],
      ['recipeBindingId', { recipeBindingId: 'js-sort-objects' }],
      ['kind', { kind: 'notebook' }],
    ] as const)('flips on persisted tab field: %s', (_label, override) => {
      const a = snapshot([baseTab()]);
      const b = snapshot([baseTab(override)]);
      expect(sessionSnapshotEqual(a, b)).toBe(false);
    });

    it('flips on activeTabId, tab count, and tab order', () => {
      const tabA = baseTab();
      const tabB = baseTab({ id: 'tab-2', name: 'other.ts' });
      expect(sessionSnapshotEqual(snapshot([tabA]), snapshot([tabA], null))).toBe(false);
      expect(sessionSnapshotEqual(snapshot([tabA]), snapshot([tabA, tabB]))).toBe(false);
      expect(sessionSnapshotEqual(snapshot([tabA, tabB]), snapshot([tabB, tabA]))).toBe(false);
    });

    // implementation note — serialization-identity lock. The helper's BINDING
    // CONTRACT with saveSession() is enforced here: states the helper
    // calls equal must serialize byte-identically, and every persisted
    // field must both flip the equality and change the serialized
    // snapshot. If saveSession learns a new field without teaching the
    // helper, the equal-pair assertion below starts failing the moment
    // a test (or reviewer) adds that field to the transient list; the
    // per-field list keeps the reverse direction honest.
    const serializeCurrentSession = (): string => {
      useSessionStore.getState().saveSession();
      const { savedTabs, savedActiveIndex } = useSessionStore.getState();
      return JSON.stringify({ savedTabs, savedActiveIndex });
    };

    it('states judged equal serialize byte-identically through saveSession', () => {
      const a = snapshot([baseTab()]);
      const b = snapshot([
        baseTab({ isDirty: true, executionState: 'success', parseError: null }),
      ]);
      expect(sessionSnapshotEqual(a, b)).toBe(true);

      useEditorStore.setState({ tabs: a.tabs, activeTabId: a.activeTabId });
      const serializedA = serializeCurrentSession();
      useEditorStore.setState({ tabs: b.tabs, activeTabId: b.activeTabId });
      const serializedB = serializeCurrentSession();
      expect(serializedB).toBe(serializedA);
    });

    it.each([
      ['name', { name: 'renamed.ts' }],
      ['language', { language: 'javascript' }],
      ['content (untitled tab)', { content: 'const x = 2;' }],
      ['filePath', { filePath: '/p/a.ts' }],
      ['runtimeMode', { runtimeMode: 'node' }],
      ['stdinBuffer', { stdinBuffer: 'line1\n' }],
      ['inputSets', { inputSets: [{ id: 'set-1', name: 'Happy', stdin: 'line1' }] }],
      ['activeInputSetId', { activeInputSetId: 'set-1' }],
      ['inputArgs', { inputArgs: ['--fast'] }],
      ['recipeBindingId', { recipeBindingId: 'js-sort-objects' }],
      ['kind (notebook, also feeds notebookTabId)', { kind: 'notebook' }],
      ['kind (sql, also feeds workspaceTabId)', { kind: 'sql' }],
    ] as const)(
      'persisted field %s flips equality AND changes the serialized snapshot',
      (_label, override) => {
        const before = snapshot([baseTab()]);
        const after = snapshot([baseTab(override)]);
        expect(sessionSnapshotEqual(before, after)).toBe(false);

        useEditorStore.setState({ tabs: before.tabs, activeTabId: before.activeTabId });
        const serializedBefore = serializeCurrentSession();
        useEditorStore.setState({ tabs: after.tabs, activeTabId: after.activeTabId });
        const serializedAfter = serializeCurrentSession();
        expect(serializedAfter).not.toBe(serializedBefore);
      }
    );

    it('activeTabId change flips equality AND moves savedActiveIndex', () => {
      const tabs = [baseTab()];
      expect(sessionSnapshotEqual(snapshot(tabs, 'tab-1'), snapshot(tabs, null))).toBe(false);

      useEditorStore.setState({ tabs, activeTabId: 'tab-1' });
      const serializedActive = serializeCurrentSession();
      useEditorStore.setState({ tabs, activeTabId: null });
      const serializedInactive = serializeCurrentSession();
      expect(serializedInactive).not.toBe(serializedActive);
    });
  });
});
