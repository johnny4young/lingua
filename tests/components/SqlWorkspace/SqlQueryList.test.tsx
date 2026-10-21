import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SqlQueryList } from '../../../src/renderer/components/SqlWorkspace/SqlQueryList';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace';

const queries = [
  createBlankSqlQuery({ id: 'a', name: 'Revenue by city', query: 'SELECT * FROM cities' }),
  createBlankSqlQuery({ id: 'b', name: 'Fixes', query: 'SELECT * FROM releases' }),
];

function renderList(filter?: string) {
  render(
    <SqlQueryList
      queries={queries}
      activeQueryId="a"
      onSelect={vi.fn()}
      onCreate={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
      {...(filter !== undefined ? { filter } : {})}
    />
  );
}

describe('SqlQueryList', () => {
  it('counts every query and narrows the rows by name or SQL with the Explorer filter', () => {
    renderList('releases');
    expect(screen.getByTestId('sql-query-list-count').textContent).toBe('2');
    const rows = screen.getAllByTestId('sql-query-list-row');
    expect(rows.map(row => row.getAttribute('data-query-id'))).toEqual(['b']);
  });

  it('says when the filter hides every query', () => {
    renderList('nothing');
    expect(screen.getByText('No queries match.')).toBeTruthy();
  });
});
