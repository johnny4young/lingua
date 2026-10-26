import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlQueryEditor } from '../../../src/renderer/components/SqlWorkspace/SqlQueryEditor';
import { getSqlQueryAutoSaveDebounceMs } from '../../../src/renderer/components/SqlWorkspace/sqlQueryEditorTiming';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace';
import { emitCommand } from '../../../src/renderer/stores/commandBus';
import {
  moveSqlCursor,
  pressSqlChord,
  resetSqlMonacoHarness,
  sqlMonacoHarness,
} from '../../__fixtures__/sqlMonacoMock';

vi.mock('@monaco-editor/react', async () => (await import('../../__fixtures__/sqlMonacoMock')).sqlMonacoModule);

describe('SqlQueryEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSqlMonacoHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-saves the query text after the debounce settles', async () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    render(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('sql-query-editor-textarea'), {
        target: { value: 'SELECT 42;' },
      });
    });

    act(() => {
      vi.advanceTimersByTime(getSqlQueryAutoSaveDebounceMs());
    });

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith('q1', { query: 'SELECT 42;' });
  });

  it('flushes the latest draft on unmount before the debounce settles', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    const { unmount } = render(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    fireEvent.change(screen.getByTestId('sql-query-editor-textarea'), {
      target: { value: 'SELECT * FROM late_draft;' },
    });

    unmount();

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith('q1', {
      query: 'SELECT * FROM late_draft;',
    });
  });

  it('appends an insert-signal table starter to the draft', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      query: 'SELECT 1;',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    const { rerender } = render(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 1 }}
      />
    );

    const textarea = screen.getByTestId(
      'sql-query-editor-textarea'
    ) as HTMLTextAreaElement;
    // nonce 1 was the initial value; bumping it triggers the append.
    rerender(
      <SqlQueryEditor
        query={query}
        onPatch={onPatch}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 2 }}
      />
    );

    expect(textarea.value).toBe('SELECT 1;\nSELECT * FROM users LIMIT 100;');

    // The appended text auto-saves after the debounce settles.
    act(() => {
      vi.advanceTimersByTime(getSqlQueryAutoSaveDebounceMs());
    });
    expect(onPatch).toHaveBeenLastCalledWith('q1', {
      query: 'SELECT 1;\nSELECT * FROM users LIMIT 100;',
    });
  });

  it('uses the bare starter when inserting into an empty draft', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });

    const { rerender } = render(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 0 }}
      />
    );
    rerender(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 1 }}
      />
    );

    expect(
      (screen.getByTestId('sql-query-editor-textarea') as HTMLTextAreaElement)
        .value
    ).toBe('SELECT * FROM users LIMIT 100;');
  });

  it('flushes the previous query draft when the active query switches', () => {
    const firstQuery = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });
    const secondQuery = createBlankSqlQuery({
      id: 'q2',
      query: 'SELECT 2;',
      now: '2026-05-26T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    const { rerender } = render(
      <SqlQueryEditor
        query={firstQuery}
        onPatch={onPatch}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    fireEvent.change(screen.getByTestId('sql-query-editor-textarea'), {
      target: { value: 'SELECT * FROM previous_query_draft;' },
    });

    rerender(
      <SqlQueryEditor
        query={secondQuery}
        onPatch={onPatch}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    // RQ-02 — the in-flight edit lands on the query it was typed into
    // (q1), never on the newly-active query (q2).
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith('q1', {
      query: 'SELECT * FROM previous_query_draft;',
    });
    expect(onPatch.mock.calls.some(([id]) => id === 'q2')).toBe(false);

    // Draining any residual timer must not produce a patch onto q2.
    act(() => {
      vi.advanceTimersByTime(getSqlQueryAutoSaveDebounceMs());
    });
    expect(onPatch.mock.calls.some(([id]) => id === 'q2')).toBe(false);
  });

  it('formats the buffer and updates the editor value', async () => {
    vi.useRealTimers();
    const query = createBlankSqlQuery({
      id: 'q1',
      query: 'select 1',
      now: '2026-05-26T00:00:00.000Z',
    });

    render(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    fireEvent.click(screen.getByTestId('sql-query-editor-format'));

    // sql-formatter is lazy-imported (real ESM dynamic import); the
    // formatted text lands in the controlled value once it resolves and
    // the setText flushes. Poll the stand-in textarea until it updates.
    // Default keywordCase: 'upper' — the lowercase select uppercases.
    await waitFor(() => {
      const textarea = screen.getByTestId(
        'sql-query-editor-textarea'
      ) as HTMLTextAreaElement;
      expect(textarea.value).toContain('SELECT');
    });
  });

  it('formats in the dialect of the engine the query runs on', async () => {
    vi.useRealTimers();
    const query = createBlankSqlQuery({ id: 'q1', query: 'select `a` from t', now: '2026-05-26T00:00:00.000Z' });
    render(<SqlQueryEditor query={query} onPatch={vi.fn()} onRun={vi.fn()} onCancel={vi.fn()} onSave={vi.fn()} isExecuting={false} tables={[]} engine="mysql" />);
    fireEvent.click(screen.getByTestId('sql-query-editor-format'));
    // DuckDB's formatter refuses backticks; MySQL's keeps them.
    await waitFor(() => expect((screen.getByTestId('sql-query-editor-textarea') as HTMLTextAreaElement).value).toBe('SELECT\n  `a`\nFROM\n  t'));
  });

  it('disables Run and Format when the query exceeds the byte cap', () => {
    // MAX_QUERY_BYTES is 1 MiB; build a string just past it.
    const huge = 'a'.repeat(1024 * 1024 + 1);
    const query = createBlankSqlQuery({
      id: 'q1',
      query: huge,
      now: '2026-05-26T00:00:00.000Z',
    });

    render(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
      />
    );

    expect(
      (screen.getByTestId('sql-query-editor-run') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId('sql-query-editor-format') as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  const renderEditor = (sql: string, props: Partial<Parameters<typeof SqlQueryEditor>[0]> = {}) => {
    const handlers = { onRun: vi.fn(), onPatch: vi.fn(), onCancel: vi.fn(), onSave: vi.fn() };
    const query = createBlankSqlQuery({ id: 'q1', query: sql, now: '2026-05-26T00:00:00.000Z' });
    render(<SqlQueryEditor query={query} isExecuting={false} tables={[]} {...handlers} {...props} />);
    return handlers;
  };
  const SCRIPT = 'SELECT 1;\nSELECT 2;';

  it('runs the statement under the cursor from the toolbar, Mod+Enter and the command bar', () => {
    const { onRun } = renderEditor(SCRIPT);
    fireEvent.click(screen.getByTestId('sql-query-editor-run'));
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({ mode: 'statement', statements: ['SELECT 1'] });
    expect(onRun.mock.calls[0]?.[0].query.query).toBe(SCRIPT);
    act(() => moveSqlCursor(SCRIPT.indexOf('SELECT 2') + 3));
    act(() => pressSqlChord('statement'));
    expect(onRun.mock.calls[1]?.[0]).toMatchObject({ mode: 'statement', statements: ['SELECT 2'] });
    act(() => {
      emitCommand('workspace.run', { kind: 'sql' });
    });
    expect(onRun.mock.calls[2]?.[0]).toMatchObject({ statements: ['SELECT 2'] });
  });

  it('shows how many statements there are and which one holds the cursor', () => {
    renderEditor(SCRIPT);
    expect(screen.getByTestId('sql-query-editor-statements').textContent).toContain('cursor in 1');
    act(() => moveSqlCursor(SCRIPT.length));
    expect(screen.getByTestId('sql-query-editor-statements').textContent).toMatch(/2 statements.*cursor in 2/);
  });

  it('runs every statement with Mod+Shift+Enter and from the menu', () => {
    const { onRun } = renderEditor(SCRIPT);
    act(() => pressSqlChord('all'));
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({ mode: 'all', statements: ['SELECT 1', 'SELECT 2'] });
    fireEvent.click(screen.getByTestId('sql-query-editor-run-menu'));
    fireEvent.click(screen.getByTestId('sql-run-menu-explain'));
    expect(onRun.mock.calls[1]?.[0]).toMatchObject({ mode: 'explain', statements: ['SELECT 1'] });
  });

  it('runs only the selection, and keeps Run selection disabled without one', () => {
    const { onRun } = renderEditor(SCRIPT);
    fireEvent.click(screen.getByTestId('sql-query-editor-run-menu'));
    expect((screen.getByTestId('sql-run-menu-selection') as HTMLButtonElement).disabled).toBe(true);
    act(() => moveSqlCursor(SCRIPT.length, { start: SCRIPT.indexOf('SELECT 2'), end: SCRIPT.length }));
    expect((screen.getByTestId('sql-run-menu-selection') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('sql-run-menu-selection'));
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({ mode: 'selection', statements: ['SELECT 2'] });
    sqlMonacoHarness.selectedRangeText = 'SELECT 1;';
    act(() => pressSqlChord('selection'));
    expect(onRun.mock.calls[1]?.[0]).toMatchObject({ statements: ['SELECT 1'] });
  });

  it('auto-saves the FULL buffer even when only a selection runs', async () => {
    const { onRun, onPatch } = renderEditor('SELECT 1;');
    await act(async () => {
      fireEvent.change(screen.getByTestId('sql-query-editor-textarea'), {
        target: { value: 'SELECT 1;\nSELECT 99;' },
      });
    });
    sqlMonacoHarness.selectedRangeText = 'SELECT 99;';
    act(() => pressSqlChord('selection'));
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({ statements: ['SELECT 99'] });
    expect(onPatch).toHaveBeenLastCalledWith('q1', { query: 'SELECT 1;\nSELECT 99;' });
  });

  it('runs the text Monaco holds when React has not caught up yet', () => {
    const { onRun, onPatch } = renderEditor('SELECT old;');
    sqlMonacoHarness.modelValue = 'SELECT new_1;\nSELECT new_2;';
    act(() => pressSqlChord('all'));
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({ statements: ['SELECT new_1', 'SELECT new_2'] });
    expect(onPatch).toHaveBeenLastCalledWith('q1', { query: 'SELECT new_1;\nSELECT new_2;' });
  });

  it('inserts a rail predicate at the cursor as WHERE, or AND after an existing WHERE', () => {
    const sql = 'SELECT * FROM t;\nSELECT * FROM u WHERE a = 1';
    const query = createBlankSqlQuery({ id: 'q1', query: sql, now: '2026-05-26T00:00:00.000Z' });
    const props = { query, isExecuting: false, tables: [], onRun: vi.fn(), onPatch: vi.fn(), onCancel: vi.fn(), onSave: vi.fn() };
    const { rerender } = render(<SqlQueryEditor {...props} />);
    act(() => moveSqlCursor('SELECT * FROM t'.length));
    rerender(<SqlQueryEditor {...props} predicateSignal={{ text: "city = 'Cali'", nonce: 1 }} />);
    expect(sqlMonacoHarness.edits.at(-1)).toBe(" WHERE city = 'Cali'");
    act(() => moveSqlCursor(sql.length));
    rerender(<SqlQueryEditor {...props} predicateSignal={{ text: 'n BETWEEN 1 AND 5', nonce: 2 }} />);
    expect(sqlMonacoHarness.edits.at(-1)).toBe(' AND n BETWEEN 1 AND 5');
    // The same signal again does not insert twice.
    rerender(<SqlQueryEditor {...props} predicateSignal={{ text: 'n BETWEEN 1 AND 5', nonce: 2 }} />);
    expect(sqlMonacoHarness.edits).toHaveLength(2);
  });

  it('turns Run into Cancel while the query runs, and Mod+. cancels', () => {
    const { onCancel, onRun } = renderEditor(SCRIPT, { isExecuting: true });
    expect(screen.queryByTestId('sql-query-editor-run')).toBeNull();
    fireEvent.click(screen.getByTestId('sql-query-editor-cancel'));
    act(() => pressSqlChord('cancel'));
    expect(onCancel).toHaveBeenCalledTimes(2);
    act(() => pressSqlChord('statement'));
    expect(onRun).not.toHaveBeenCalled();
  });

  it('waits while another query runs', () => {
    const { onRun } = renderEditor(SCRIPT, { isBusy: true });
    expect((screen.getByTestId('sql-query-editor-run') as HTMLButtonElement).disabled).toBe(true);
    act(() => pressSqlChord('statement'));
    expect(onRun).not.toHaveBeenCalled();
  });

  it('routes Mod+S and Mod+Shift+S from the editor and the app to onSave', () => {
    const { onSave } = renderEditor(SCRIPT);
    act(() => pressSqlChord('save'));
    act(() => pressSqlChord('saveAs'));
    act(() => {
      emitCommand('workspace.save', { kind: 'sql', as: true });
    });
    expect(onSave.mock.calls).toEqual([[false], [true], [true]]);
  });

  it('registers a sql completion provider that returns the table names', () => {
    const query = createBlankSqlQuery({
      id: 'q1',
      now: '2026-05-26T00:00:00.000Z',
    });

    render(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[
          { name: 'orders' },
          { name: 'customers' },
          { name: 'Order Items' },
        ]}
      />
    );

    expect(sqlMonacoHarness.completionProvider).not.toBeNull();
    const result = sqlMonacoHarness.completionProvider?.provideCompletionItems(
      { getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }) },
      { lineNumber: 1, column: 1 }
    );
    const labels = result?.suggestions.map((s) => s.label) ?? [];
    expect(labels).toContain('orders');
    expect(labels).toContain('customers');
    expect(result?.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Order Items',
          insertText: '"Order Items"',
        }),
      ])
    );
    // Common keywords ride alongside the table names.
    expect(labels).toContain('SELECT');
  });
  it('runs the latest draft from the toolbar before React renders it', async () => {
    const { onRun, onPatch } = renderEditor('SELECT old;');
    await act(async () => {
      sqlMonacoHarness.type('SELECT 707 AS current;');
      fireEvent.click(screen.getByTestId('sql-query-editor-run'));
      expect(onRun).toHaveBeenCalledTimes(1);
      expect(onRun.mock.calls[0]?.[0].query.query).toBe('SELECT 707 AS current;');
      expect(onPatch).toHaveBeenLastCalledWith('q1', { query: 'SELECT 707 AS current;' });
    });
  });

  it('formats the latest draft even before React renders it', async () => {
    vi.useRealTimers();
    renderEditor('select old');
    const textarea = screen.getByTestId('sql-query-editor-textarea') as HTMLTextAreaElement;
    await act(async () => {
      sqlMonacoHarness.type('select latest');
      pressSqlChord('format');
    });
    await waitFor(() => expect(textarea.value).toBe('SELECT\n  latest'));
  });

  it('checks the byte cap on the latest draft before React renders it', async () => {
    const { onRun } = renderEditor('SELECT 1;');
    await act(async () => {
      sqlMonacoHarness.type('a'.repeat(256 * 1024 + 1));
      fireEvent.click(screen.getByTestId('sql-query-editor-run'));
      expect(onRun).not.toHaveBeenCalled();
      sqlMonacoHarness.modelValue = 'b'.repeat(256 * 1024 + 1);
      act(() => pressSqlChord('all'));
      expect(onRun).not.toHaveBeenCalled();
    });
  });

});
