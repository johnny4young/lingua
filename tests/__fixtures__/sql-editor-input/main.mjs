// Synthetic real-component fixture. It never executes SQL or imports the app bootstrap.
import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { SqlQueryEditor } from '../../../src/renderer/components/SqlWorkspace/SqlQueryEditor.tsx';
import { useWorkspaceSqlStore } from '../../../src/renderer/stores/workspaceSqlStore.ts';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace.ts';
import { initI18n, changeAppLanguage } from '../../../src/renderer/i18n/index.ts';
import { getConfiguredMonaco } from '../../../src/renderer/monaco.ts';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore.ts';
const h = React.createElement,
  events = [];
let seq = 0,
  trial = 0,
  currentEditor,
  caseMode = 'idle',
  caseStart = 0,
  pendingReady = false;
const INITIAL = 'SELECT 999999 AS initial',
  SEED = 'SELECT 420000 AS pending';
const trace = (kind, payload = {}) => {
  if (events.length < 12000)
    events.push({ seq: ++seq, at: performance.now(), wall: Date.now(), kind, ...payload });
};
const phase = v => {
  const el = document.getElementById('phase');
  if (el) el.textContent = v;
  trace('phase', { value: v });
};
await initI18n('en');
useSettingsStore.setState({ fontFamily: 'monospace' });
const m = getConfiguredMonaco();
useWorkspaceSqlStore.subscribe((state, prev) => {
  if (state.queries[0] !== prev.queries[0])
    trace('store.query', { query: state.queries[0]?.query, id: state.queries[0]?.id });
});
m.editor.onDidCreateEditor(editor => {
  currentEditor = editor;
  trace('editor.created');
  editor.onDidChangeModelContent(e =>
    trace('model.change', {
      value: editor.getValue(),
      version: editor.getModel()?.getVersionId(),
      isFlush: e.isFlush,
      changes: e.changes.map(c => ({ offset: c.rangeOffset, length: c.rangeLength, text: c.text })),
    })
  );
  editor.onDidChangeCursorSelection(e =>
    trace('model.selection', {
      value: editor.getValue(),
      source: e.source,
      offset: editor.getModel()?.getOffsetAt(e.selection.getPosition()),
    })
  );
  editor.onDidType(text => trace('editor.didType', { text, value: editor.getValue() }));
  editor.onDidDispose(() => trace('editor.disposed'));
  requestAnimationFrame(() =>
    requestAnimationFrame(async () => {
      if (!pendingReady || editor !== currentEditor) return;
      pendingReady = false;
      trace('editor.ready', { value: editor.getValue() });
      if (caseMode === 'locale') {
        trace('locale.begin', { to: 'es' });
        await changeAppLanguage('es', async () => ['en']);
        trace('locale.end', { language: document.documentElement.lang });
        phase('typing-ready');
      } else if (caseMode.startsWith('save')) {
        trace('seed.begin', { source: SEED });
        editor.executeEdits('qa-prepare', [
          { range: editor.getModel().getFullModelRange(), text: SEED },
        ]);
        trace('seed.end', { source: editor.getValue() });
        const delay = Number(caseMode.slice(4));
        setTimeout(() => phase('typing-ready'), delay);
      } else phase('typing-ready');
    })
  );
});
for (const type of ['keydown', 'keyup', 'beforeinput', 'input'])
  document.addEventListener(
    type,
    e => {
      if (!e.target.closest?.('[data-testid="sql-query-editor-monaco"]')) return;
      trace('dom.' + type, { key: e.key, data: e.data, inputType: e.inputType });
    },
    true
  );
function App() {
  const query = useWorkspaceSqlStore(s => s.queries[0]);
  const [key, setKey] = useState(0);
  const [predicate, setPredicate] = useState(undefined);
  const onPatch = useCallback((id, patch) => {
    trace('save.patch', { id, query: patch.query });
    useWorkspaceSqlStore.getState().updateQuery(id, patch);
    trace('save.return', { saved: useWorkspaceSqlStore.getState().queries[0]?.query });
  }, []);
  const reset = async mode => {
    phase('resetting');
    await changeAppLanguage('en', async () => ['en']);
    trial++;
    caseMode = mode;
    caseStart = performance.now();
    events.length = 0;
    seq = 0;
    trace('case.start', { trial, mode });
    pendingReady = true;
    const q = createBlankSqlQuery({
      id: 'synthetic-' + trial,
      query: INITIAL,
      now: '2026-10-24T00:00:00.000Z',
    });
    useWorkspaceSqlStore.setState({ queries: [q], activeQueryId: q.id, openQueryIds: [q.id] });
    setKey(trial);
  };
  const dump = () => {
    trace('snapshot');
    document.getElementById('snapshot').textContent = JSON.stringify({
      trial,
      mode: caseMode,
      start: caseStart,
      timeOrigin: performance.timeOrigin,
      model: currentEditor?.getValue(),
      modelVersion: currentEditor?.getModel()?.getVersionId(),
      saved: useWorkspaceSqlStore.getState().queries[0]?.query,
      persisted: JSON.parse(localStorage.getItem('lingua-workspace-sql-state') ?? '{}').state
        ?.queries?.[0]?.query,
      language: document.documentElement.lang,
      viewport: { width: innerWidth, height: innerHeight },
      events: events.slice(),
    });
  };
  return h(
    'main',
    null,
    h('h3', null, 'Synthetic real-component SQL control'),
    ...['idle', 'locale', 'save450', 'save490'].map(mode =>
      h('button', { id: 'reset-' + mode, key: mode, onClick: () => void reset(mode) }, mode)
    ),
    h('button', { id: 'dump', onClick: dump }, 'Snapshot synthetic timeline'),
    h(
      'button',
      {
        id: 'predicate',
        onClick: () => setPredicate({ text: ' /* synthetic */', nonce: Date.now(), raw: true }),
      },
      'Insert synthetic predicate'
    ),
    h('span', { id: 'phase' }, 'not-started'),
    query
      ? h(SqlQueryEditor, {
          key,
          query,
          onPatch,
          onRun: r => trace('run.request', { source: r.query.query, statements: r.statements }),
          onCancel: () => trace('cancel'),
          onSave: () => trace('save.gesture'),
          predicateSignal: predicate,
          isExecuting: false,
          tables: [],
          engine: 'sqlite',
        })
      : null,
    h('pre', { id: 'snapshot' })
  );
}
createRoot(document.getElementById('root')).render(h(App));
