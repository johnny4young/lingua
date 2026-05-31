import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSessionStore } from '@/stores/sessionStore';
import {
  useEditorStore,
  SQL_WORKSPACE_TAB_ID,
  HTTP_WORKSPACE_TAB_ID,
} from '@/stores/editorStore';
import {
  resetRecipeStoreForTests,
  useRecipeStore,
} from '@/stores/recipeStore';
import { useUIStore } from '@/stores/uiStore';
import {
  resetWorkspaceSqlStoreForTests,
  useWorkspaceSqlStore,
} from '@/stores/workspaceSqlStore';
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

    // Active tab should be the second one (index 1)
    expect(activeTabId).toBe(tabs[1].id);
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
    expect(useRecipeStore.getState().getBindingForTab(tabs[0].id)).toBe(
      'js-sort-objects'
    );
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
    (window.lingua.fs.read as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ENOENT')
    );

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
  describe('SQL / HTTP workspace tab restore', () => {
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
      const restoredRequest = useWorkspaceToolStore
        .getState()
        .getRequest('request-uuid-1');
      expect(restoredRequest?.url).toBe('https://api.example.com/users');
      expect(restoredRequest?.method).toBe('POST');
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
        useWorkspaceSqlStore
          .getState()
          .createQuery(createBlankSqlQuery({ id, name: id, query }));
      }
      for (const [id, url] of [
        ['legacy-http-1', 'https://a.dev'],
        ['legacy-http-2', 'https://b.dev'],
      ] as const) {
        const blank = createBlankHttpRequest({ id, name: id });
        useWorkspaceToolStore
          .getState()
          .createRequest({ ...blank, url });
      }

      // A legacy session: one FileTab per query/request, ids = entry ids.
      useSessionStore.setState({
        savedTabs: [
          { name: 'q1', language: 'sql', content: '', kind: 'sql', workspaceTabId: 'legacy-sql-1' },
          { name: 'q2', language: 'sql', content: '', kind: 'sql', workspaceTabId: 'legacy-sql-2' },
          { name: 'q3', language: 'sql', content: '', kind: 'sql', workspaceTabId: 'legacy-sql-3' },
          { name: 'r1', language: 'http', content: '', kind: 'http', workspaceTabId: 'legacy-http-1' },
          { name: 'r2', language: 'http', content: '', kind: 'http', workspaceTabId: 'legacy-http-2' },
        ],
        // The active tab was the second SQL query — it must remap onto
        // the single surviving SQL workspace tab.
        savedActiveIndex: 1,
      });

      await useSessionStore.getState().restoreSession();

      const { tabs, activeTabId } = useEditorStore.getState();
      // Collapsed: exactly one SQL tab + one HTTP tab, on the stable ids.
      const sqlTabs = tabs.filter((t) => t.kind === 'sql');
      const httpTabs = tabs.filter((t) => t.kind === 'http');
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
});
