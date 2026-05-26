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
    expect(onPatch).toHaveBeenLastCalledWith({ query: 'SELECT 42;' });
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
    expect(onPatch).toHaveBeenLastCalledWith({
      query: 'SELECT * FROM late_draft;',
    });
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
    const onFirstPatch = vi.fn();
    const onSecondPatch = vi.fn();

    const { rerender } = render(
      <SqlQueryEditor
        query={firstQuery}
        onPatch={onFirstPatch}
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
        onPatch={onSecondPatch}
        onRun={vi.fn()}
        isExecuting={false}
      />
    );

    expect(onFirstPatch).toHaveBeenCalledTimes(1);
    expect(onFirstPatch).toHaveBeenLastCalledWith({
      query: 'SELECT * FROM previous_query_draft;',
    });
    expect(onSecondPatch).not.toHaveBeenCalled();
  });
});
