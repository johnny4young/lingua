import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlQueryEditor } from '../../../src/renderer/components/SqlWorkspace/SqlQueryEditor';
import { getSqlQueryAutoSaveDebounceMs } from '../../../src/renderer/components/SqlWorkspace/sqlQueryEditorTiming';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace';

describe('SqlQueryEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-saves the query text after the debounce settles', () => {
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
        isExecuting={false}
      />
    );

    fireEvent.change(screen.getByTestId('sql-query-editor-textarea'), {
      target: { value: 'SELECT 42;' },
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
        isExecuting={false}
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
        isExecuting={false}
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
        isExecuting={false}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 2 }}
      />
    );

    expect(textarea.value).toBe(
      'SELECT 1;\nSELECT * FROM users LIMIT 100;'
    );

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
        isExecuting={false}
        insertSignal={{ text: 'SELECT * FROM users LIMIT 100;', nonce: 0 }}
      />
    );
    rerender(
      <SqlQueryEditor
        query={query}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        isExecuting={false}
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
        isExecuting={false}
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
        isExecuting={false}
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
});
